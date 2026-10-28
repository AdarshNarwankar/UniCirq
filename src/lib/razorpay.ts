import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './policy';
import { readBoundedJson } from './http-body';

export interface RazorpayConfiguration { keyId: string; keySecret: string; webhookSecret: string }
export interface RazorpayOrder { id: string; amount: number; currency: 'INR'; receipt: string; status: string }
export interface RazorpayPayment { id: string; order_id: string; amount: number; currency: string; status: string; captured: boolean }
export interface RazorpayRefund { id: string; payment_id: string; amount: number; status: string }
type Environment = Record<string, string | undefined>;
type Fetcher = typeof fetch;

/** This first release deliberately cannot use live Razorpay credentials. */
export function razorpayConfiguration(env: Environment): RazorpayConfiguration | null {
  if (env.NEXT_PUBLIC_RAZORPAY_KEY_SECRET || env.NEXT_PUBLIC_RAZORPAY_WEBHOOK_SECRET) return null;
  const keyId = env.RAZORPAY_KEY_ID ?? '', keySecret = env.RAZORPAY_KEY_SECRET ?? '', webhookSecret = env.RAZORPAY_WEBHOOK_SECRET ?? '';
  if (!/^rzp_test_[A-Za-z0-9]{8,64}$/.test(keyId) || keySecret.length < 16 || webhookSecret.length < 32 ||
      [keySecret, webhookSecret].some(value => value.trim() !== value || /[\r\n]/.test(value))) return null;
  return { keyId, keySecret, webhookSecret };
}

function id(value: unknown, prefix: 'order' | 'pay' | 'rfnd'): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]{6,64}$`).test(value);
}
function money(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }

export function verifyRazorpaySignature(message: string, supplied: string, secret: string): boolean {
  if (!/^[a-fA-F0-9]{64}$/.test(supplied)) return false;
  const expected = createHmac('sha256', secret).update(message).digest();
  return timingSafeEqual(expected, Buffer.from(supplied, 'hex'));
}

async function api(path: string, configuration: RazorpayConfiguration, fetcher: Fetcher, body?: object): Promise<Record<string, unknown>> {
  try {
    const response = await fetcher('https://api.razorpay.com/v1/' + path, {
      method: body ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: 'Basic ' + Buffer.from(configuration.keyId + ':' + configuration.keySecret).toString('base64'), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error();
    const result = await readBoundedJson(response, 64_000);
    if (!object(result)) throw new Error();
    return result;
  } catch { throw new AppError('The test payment service is unavailable. Please retry from billing history.', 503); }
}

export async function createRazorpayTestOrder(amount: number, billingId: string, configuration: RazorpayConfiguration, fetcher: Fetcher = fetch): Promise<RazorpayOrder> {
  if (!money(amount) || !/^[a-f0-9-]{36}$/i.test(billingId)) throw new AppError('Invalid billing reference', 400);
  const result = await api('orders', configuration, fetcher, { amount, currency: 'INR', receipt: billingId, notes: { billing_id: billingId, mode: 'test' } });
  if (!id(result.id, 'order') || result.amount !== amount || result.currency !== 'INR' || result.receipt !== billingId || result.status !== 'created') {
    throw new AppError('The test payment order could not be verified.', 503);
  }
  return result as unknown as RazorpayOrder;
}

export async function fetchRazorpayPayment(paymentId: string, configuration: RazorpayConfiguration, fetcher: Fetcher = fetch): Promise<RazorpayPayment> {
  if (!id(paymentId, 'pay')) throw new AppError('Invalid payment reference', 400);
  const result = await api('payments/' + paymentId, configuration, fetcher);
  if (result.id !== paymentId || !id(result.order_id, 'order') || !money(result.amount) || typeof result.currency !== 'string' ||
      typeof result.status !== 'string' || typeof result.captured !== 'boolean') throw new AppError('The test payment response could not be verified.', 503);
  return result as unknown as RazorpayPayment;
}

export function assertCapturedPayment(payment: RazorpayPayment, expected: { provider_order_id: string | null; provider_payment_id?: string | null; status?: string; quote: { buyer_total: number | null } }) {
  if (payment.order_id !== expected.provider_order_id || payment.amount !== expected.quote.buyer_total || payment.currency !== 'INR') {
    throw new AppError('Payment details do not match this billing record.', 409);
  }
  // A delayed capture notification must not fail forever after its matching
  // payment was already reconciled and refunded. The SQL gateway remains a no-op.
  if (payment.status === 'refunded' && expected.provider_payment_id === payment.id && ['paid', 'refunded'].includes(expected.status ?? '')) return;
  if (payment.status !== 'captured' || !payment.captured) throw new AppError('Payment is awaiting capture. Check billing history shortly.', 409);
}

export async function fetchRazorpayRefund(refundId: string, configuration: RazorpayConfiguration, fetcher: Fetcher = fetch): Promise<RazorpayRefund> {
  if (!id(refundId, 'rfnd')) throw new AppError('Invalid refund reference', 400);
  const result = await api('refunds/' + refundId, configuration, fetcher);
  if (result.id !== refundId || !id(result.payment_id, 'pay') || !money(result.amount) || typeof result.status !== 'string') {
    throw new AppError('The test refund response could not be verified.', 503);
  }
  return result as unknown as RazorpayRefund;
}
