import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readBoundedJson } from '../src/lib/http-body';
import { assertCapturedPayment, createRazorpayTestOrder, fetchRazorpayPayment, fetchRazorpayRefund, razorpayConfiguration, verifyRazorpaySignature } from '../src/lib/razorpay';

const configuration = { keyId: 'rzp_test_abcdefgh12345', keySecret: 'test-only-private-key-secret', webhookSecret: 'test-only-webhook-secret-at-least-thirty-two' };
const bill = '2b391f42-7ee6-4f8f-913a-a592e64f98eb';
test('billing gateway fails closed on live keys, public secrets and incomplete test credentials', () => {
  const env = { RAZORPAY_KEY_ID: configuration.keyId, RAZORPAY_KEY_SECRET: configuration.keySecret, RAZORPAY_WEBHOOK_SECRET: configuration.webhookSecret };
  assert.deepEqual(razorpayConfiguration(env), configuration);
  for (const patch of [{ RAZORPAY_KEY_ID: 'rzp_live_abcdefgh12345' }, { NEXT_PUBLIC_RAZORPAY_KEY_SECRET: 'leaked' }, { NEXT_PUBLIC_RAZORPAY_WEBHOOK_SECRET: 'leaked' }, { RAZORPAY_KEY_SECRET: '' }, { RAZORPAY_WEBHOOK_SECRET: 'short' }]) assert.equal(razorpayConfiguration({ ...env, ...patch }), null);
});
test('billing reader cancels over-limit streamed bytes before consuming the whole request', async () => {
  let chunks = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(4096)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedJson({ headers: new Headers(), body: stream }), /too large/);
  assert.equal(cancelled, true); assert.ok(chunks <= 5);
  const oversized = new Request('https://example.test', { method: 'POST', headers: { 'Content-Length': '12001' }, body: '{}' });
  await assert.rejects(readBoundedJson(oversized), /too large/);
  assert.deepEqual(await readBoundedJson(new Request('https://example.test', { method: 'POST', body: '{"ok":true}' })), { ok: true });
  await assert.rejects(readBoundedJson(new Response('{')), /Invalid request/);
});
test('checkout signatures bind stored order and payment while malformed or changed signatures fail', () => {
  const message = 'order_abcdefgh|pay_abcdefgh';
  const signature = createHmac('sha256', configuration.keySecret).update(message).digest('hex');
  assert.equal(verifyRazorpaySignature(message, signature, configuration.keySecret), true);
  assert.equal(verifyRazorpaySignature('order_foreign|pay_abcdefgh', signature, configuration.keySecret), false);
  for (const value of ['', 'xyz', signature.slice(1), '0'.repeat(64)]) assert.equal(verifyRazorpaySignature(message, value, configuration.keySecret), false);
  const webhookSignature = createHmac('sha256', configuration.webhookSecret).update('{"event":"payment.captured"}').digest('hex');
  assert.equal(verifyRazorpaySignature('{"event":"payment.captured"}', webhookSignature, configuration.webhookSecret), true);
  assert.equal(verifyRazorpaySignature('{"event": "payment.captured"}', webhookSignature, configuration.webhookSecret), false);
});
test('gateway creates server-priced INR orders without putting credentials or customer data in the body', async () => {
  const fetcher: typeof fetch = async (url, input) => {
    assert.equal(url, 'https://api.razorpay.com/v1/orders'); assert.equal(input?.redirect, 'error');
    assert.ok(new Headers(input?.headers).get('Authorization')?.startsWith('Basic '));
    const body = JSON.parse(String(input?.body));
    assert.deepEqual(body, { amount: 105000, currency: 'INR', receipt: bill, notes: { billing_id: bill, mode: 'test' } });
    assert.doesNotMatch(String(input?.body), /key-secret|webhook-secret/);
    return Response.json({ id: 'order_abcdefgh', ...body, status: 'created' });
  };
  assert.equal((await createRazorpayTestOrder(105000, bill, configuration, fetcher)).id, 'order_abcdefgh');
  await assert.rejects(createRazorpayTestOrder(0, bill, configuration, fetcher), /Invalid billing/);
  for (const response of [Response.json({ id: 'order_abcdefgh', amount: 1, currency: 'USD', receipt: bill, status: 'created' }), new Response('private-provider-error', { status: 500 })]) {
    await assert.rejects(createRazorpayTestOrder(105000, bill, configuration, async () => response), error => error instanceof Error && !error.message.includes('private-provider-error'));
  }
});
test('captured payment checks reject amount, currency, order and authorization-only mismatches', async () => {
  const payment = { id: 'pay_abcdefgh', order_id: 'order_abcdefgh', amount: 105000, currency: 'INR', status: 'captured', captured: true };
  const expected = { provider_order_id: payment.order_id, quote: { buyer_total: payment.amount } };
  assertCapturedPayment(await fetchRazorpayPayment(payment.id, configuration, async () => Response.json(payment)), expected);
  for (const patch of [{ amount: 100000 }, { currency: 'USD' }, { order_id: 'order_foreign' }, { status: 'authorized', captured: false }]) assert.throws(() => assertCapturedPayment({ ...payment, ...patch }, expected));
  assertCapturedPayment({ ...payment, status: 'refunded' }, { ...expected, provider_payment_id: payment.id, status: 'refunded' });
  assert.throws(() => assertCapturedPayment({ ...payment, status: 'refunded' }, expected), /awaiting capture/);
  await assert.rejects(fetchRazorpayPayment('../orders', configuration), /Invalid payment/);
  assert.deepEqual(await fetchRazorpayRefund('rfnd_abcdefgh', configuration, async () => Response.json({ id: 'rfnd_abcdefgh', payment_id: payment.id, amount: 1900, status: 'processed' })), { id: 'rfnd_abcdefgh', payment_id: payment.id, amount: 1900, status: 'processed' });
  await assert.rejects(fetchRazorpayRefund('rfnd_abcdefgh', configuration, async () => Response.json({ id: 'rfnd_wrongwrong', payment_id: payment.id, amount: 1900, status: 'processed' })), /could not be verified/);
});
