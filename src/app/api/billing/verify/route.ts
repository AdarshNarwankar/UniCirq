import { z } from 'zod';
import { requireApiUser } from '@/lib/server/auth';
import { body, checkOrigin, failure, json } from '@/lib/server/http';
import { billingFailure, limitBilling, ownedBillingRecord, withBillingService } from '@/lib/server/billing';
import { razorpayConfiguration, verifyRazorpaySignature, fetchRazorpayPayment, assertCapturedPayment } from '@/lib/razorpay';
import { AppError } from '@/lib/policy';

export const runtime = 'nodejs';
const schema = z.strictObject({ billing_id: z.string().uuid(), razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]{6,64}$/), razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{6,64}$/), razorpay_signature: z.string().regex(/^[A-Fa-f0-9]{64}$/) });
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const actor = await requireApiUser();
    await limitBilling(actor.id, 20);
    const input = schema.parse(await body(request));
    const configuration = razorpayConfiguration(process.env);
    if (!configuration) throw new AppError('Razorpay test checkout is not configured.', 503);
    const record = await ownedBillingRecord(actor, input.billing_id);
    if (record.provider_order_id !== input.razorpay_order_id || !verifyRazorpaySignature(record.provider_order_id + '|' + input.razorpay_payment_id, input.razorpay_signature, configuration.keySecret)) {
      throw new AppError('The payment signature could not be verified.', 400);
    }
    const payment = await fetchRazorpayPayment(input.razorpay_payment_id, configuration);
    assertCapturedPayment(payment, record);
    const saved = await withBillingService(async client => (await client.query('SELECT app_billing_capture($1,$2,$3,$4,$5,$6) AS record', [record.id, payment.order_id, payment.id, payment.amount, payment.currency, 'capture:' + payment.id])).rows[0].record);
    return json({ record: saved });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Invalid payment confirmation.' }, 400);
    return failure(billingFailure(error));
  }
}
