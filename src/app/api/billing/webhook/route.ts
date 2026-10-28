import { z } from 'zod';
import { readBoundedText } from '@/lib/http-body';
import { razorpayConfiguration, verifyRazorpaySignature, fetchRazorpayPayment, fetchRazorpayRefund, assertCapturedPayment } from '@/lib/razorpay';
import { billingFailure, withBillingService } from '@/lib/server/billing';
import { failure, json } from '@/lib/server/http';
import { AppError } from '@/lib/policy';
import type { BillingRecord } from '@/lib/billing';

export const runtime = 'nodejs';
const eventSchema = z.object({ event: z.string().max(100), payload: z.object({ payment: z.object({ entity: z.object({ id: z.string(), order_id: z.string() }) }).optional(), refund: z.object({ entity: z.object({ id: z.string() }) }).optional() }) });
export async function POST(request: Request) {
  try {
    const configuration = razorpayConfiguration(process.env);
    if (!configuration) throw new AppError('Test payment webhook is not configured.', 503);
    const raw = await readBoundedText(request, 128_000);
    if (!verifyRazorpaySignature(raw, request.headers.get('x-razorpay-signature') ?? '', configuration.webhookSecret)) throw new AppError('Invalid webhook signature.', 400);
    let input: z.infer<typeof eventSchema>;
    try { input = eventSchema.parse(JSON.parse(raw)); }
    catch { throw new AppError('Invalid webhook event.', 400); }
    if (!['payment.captured', 'order.paid', 'refund.processed'].includes(input.event)) return json({ received: true, ignored: true });
    if (input.event === 'refund.processed') {
      const refundId = input.payload.refund?.entity.id;
      if (!refundId) throw new AppError('Invalid refund event.', 400);
      const refund = await fetchRazorpayRefund(refundId, configuration);
      if (refund.status !== 'processed') return json({ received: true, pending: true });
      const payment = await fetchRazorpayPayment(refund.payment_id, configuration);
      const record = await lookup(payment.order_id);
      if (!record) return json({ received: true, ignored: true });
      // A processed refund can arrive before the captured webhook. Record both
      // facts in one transaction; never let delivery ordering grant a benefit twice.
      if (payment.order_id !== record.provider_order_id || payment.amount !== record.quote.buyer_total || payment.currency !== 'INR' || !['captured', 'refunded'].includes(payment.status)) throw new AppError('Refund details do not match billing.', 409);
      await withBillingService(async client => {
        await client.query('SELECT app_billing_capture($1,$2,$3,$4,$5,$6)', [record.id, payment.order_id, payment.id, payment.amount, payment.currency, 'capture:' + payment.id]);
        await client.query('SELECT app_billing_refund($1,$2,$3,$4)', [record.id, refund.payment_id, refund.amount, 'refund:' + refund.id]);
      });
    } else {
      const entity = input.payload.payment?.entity;
      if (!entity) throw new AppError('Invalid payment event.', 400);
      const record = await lookup(entity.order_id);
      if (!record) return json({ received: true, ignored: true });
      const payment = await fetchRazorpayPayment(entity.id, configuration);
      assertCapturedPayment(payment, record);
      await withBillingService(async client => {
        await client.query('SELECT app_billing_capture($1,$2,$3,$4,$5,$6)', [record.id, payment.order_id, payment.id, payment.amount, payment.currency, 'capture:' + payment.id]);
      });
    }
    return json({ received: true });
  } catch (error) { return failure(billingFailure(error)); }
}
async function lookup(providerOrderId: string): Promise<BillingRecord | null> {
  if (!/^order_[A-Za-z0-9]{6,64}$/.test(providerOrderId)) throw new AppError('Invalid payment order.', 400);
  return withBillingService(async client => (await client.query('SELECT app_billing_gateway_record($1) AS record', [providerOrderId])).rows[0].record);
}
