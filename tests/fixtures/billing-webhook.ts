import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { POST } from '../../src/app/api/billing/webhook/route';
import { seedState, ids } from '../../src/lib/seed';
import type { BillingRecord } from '../../src/lib/billing';

const db = new PGlite();
const webhookSecret = 'isolated-test-webhook-secret-at-least-thirty-two';
const realFetch = globalThis.fetch;
const gatewayPayments = new Map<string, object>(), gatewayRefunds = new Map<string, object>();
let calls = 0;
process.env.DATABASE_URL = 'postgresql://runtime:fixture@127.0.0.1/isolated';
process.env.RAZORPAY_KEY_ID = 'rzp_test_abcdefgh12345';
process.env.RAZORPAY_KEY_SECRET = 'isolated-private-test-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;
process.env.UNICIRQ_DEMO_MODE = 'false';
const globals = globalThis as unknown as { unicirqPool: unknown };
globals.unicirqPool = { async connect() { return { query: (sql: string, values?: unknown[]) => db.query(sql, values), release() {} }; } };
globalThis.fetch = async input => {
  const url = String(input); calls++;
  const value = url.includes('/payments/') ? gatewayPayments.get(url.split('/').at(-1)!) : url.includes('/refunds/') ? gatewayRefunds.get(url.split('/').at(-1)!) : undefined;
  assert.ok(value, 'Unexpected external request in isolated fixture: ' + url);
  return Response.json(value);
};

before(async () => {
  for (const name of (await readdir('database/migrations')).sort()) await db.exec(await readFile('database/migrations/' + name, 'utf8'));
  const state = seedState();
  for (const campus of state.colleges) await db.query('INSERT INTO colleges(id,name,short_name,domain,city) VALUES($1,$2,$3,$4,$5)', [campus.id, campus.name, campus.short_name, campus.domain, campus.city]);
  for (const profile of state.profiles) {
    await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [profile.id, profile.name, profile.id + '@example.test']);
    await db.query('UPDATE profiles SET role=$2,college_id=$3,verified=$4,suspended=$5 WHERE id=$1', [profile.id, profile.role, profile.college_id, profile.verified, profile.suspended]);
  }
  await db.exec(`CREATE ROLE isolated_billing_runtime NOLOGIN; GRANT unicirq_app,unicirq_billing_backend TO isolated_billing_runtime; GRANT USAGE ON SCHEMA public TO isolated_billing_runtime;`);
  await asActor(ids.admin, async () => db.query('SELECT app_billing_configure($1::jsonb)', [JSON.stringify({ tax_bps: 0, business_pilot: true, reason: 'Configure isolated sandbox tests' })]));
});
after(async () => { globalThis.fetch = realFetch; delete (globals as { unicirqPool?: unknown }).unicirqPool; await db.close(); });

async function asActor<T>(actor: string, operation: () => Promise<T>) {
  await db.exec('BEGIN; SET LOCAL ROLE unicirq_app;');
  await db.query("SELECT set_config('app.user_id',$1,true)", [actor]);
  try { const result = await operation(); await db.exec('COMMIT'); return result; }
  catch (error) { await db.exec('ROLLBACK'); throw error; }
}
async function bill(suffix: string) {
  const listing = await asActor(ids.student, async () => (await db.query<{ result: { id: string } }>('SELECT unicirq_command($1::jsonb) AS result', [JSON.stringify({ type: 'create_listing', title: 'Webhook listing ' + suffix, description: 'An isolated photo-free test listing for webhook integration.', kind: 'sale', category: 'Books & notes', price: 20000, unit: 'item', condition: 'Good', location: 'Public campus entrance' })])).rows[0].result);
  const created = await asActor(ids.student, async () => (await db.query<{ record: BillingRecord }>('SELECT app_billing_create($1::jsonb) AS record', [JSON.stringify({ purpose: 'boost', reference_id: listing.id, payment_mode: 'checkout' })])).rows[0].record);
  const providerOrder = 'order_' + suffix.padEnd(10, 'x');
  await db.query('SELECT app_billing_attach($1,$2)', [created.id, providerOrder]);
  return { ...created, provider_order_id: providerOrder };
}
async function notify(event: object, signature?: string) {
  const raw = JSON.stringify(event);
  return POST(new Request('https://unicirq.example/api/billing/webhook', { method: 'POST', headers: { 'x-razorpay-signature': signature ?? createHmac('sha256', webhookSecret).update(raw).digest('hex'), 'Content-Type': 'application/json' }, body: raw }));
}
async function stored(id: string) { return (await db.query<BillingRecord>('SELECT * FROM billing_records WHERE id=$1', [id])).rows[0]; }

test('invalid signatures and amount mismatches cannot mark a bill paid', async () => {
  const record = await bill('invalid');
  const paymentId = 'pay_invalidxxx';
  const event = { event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: record.provider_order_id } } } };
  const beforeCalls = calls;
  assert.equal((await notify(event, '0'.repeat(64))).status, 400); assert.equal(calls, beforeCalls);
  gatewayPayments.set(paymentId, { id: paymentId, order_id: record.provider_order_id, amount: 1, currency: 'INR', status: 'captured', captured: true });
  assert.equal((await notify(event)).status, 409);
  assert.equal((await stored(record.id)).status, 'pending');
  assert.equal((await db.query('SELECT * FROM billing_events WHERE billing_id=$1', [record.id])).rows.length, 0);
});
test('signed capture retries, partial refunds and delayed capture after full refund are idempotent', async () => {
  const record = await bill('complete');
  const paymentId = 'pay_completexx';
  const payment = { id: paymentId, order_id: record.provider_order_id, amount: record.quote.buyer_total, currency: 'INR', status: 'captured', captured: true };
  gatewayPayments.set(paymentId, payment);
  const event = { event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: record.provider_order_id } } } };
  assert.equal((await notify(event)).status, 200); assert.equal((await notify(event)).status, 200);
  assert.equal((await stored(record.id)).status, 'paid');
  assert.equal((await db.query('SELECT * FROM billing_entitlements WHERE billing_id=$1', [record.id])).rows.length, 1);
  gatewayRefunds.set('rfnd_partialxx', { id: 'rfnd_partialxx', payment_id: paymentId, amount: 1000, status: 'processed' });
  const partial = { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_partialxx' } } } };
  assert.equal((await notify(partial)).status, 200); assert.equal((await notify(partial)).status, 200);
  assert.equal(Number((await stored(record.id)).refunded_amount), 1000);
  gatewayRefunds.set('rfnd_remainder', { id: 'rfnd_remainder', payment_id: paymentId, amount: record.quote.buyer_total! - 1000, status: 'processed' });
  gatewayPayments.set(paymentId, { ...payment, status: 'refunded' });
  assert.equal((await notify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_remainder' } } } })).status, 200);
  assert.equal((await stored(record.id)).status, 'refunded');
  assert.equal((await notify(event)).status, 200);
  assert.equal((await db.query('SELECT * FROM billing_entitlements WHERE billing_id=$1 AND expires_at>now()', [record.id])).rows.length, 0);
  assert.equal((await db.query('SELECT * FROM billing_events WHERE billing_id=$1', [record.id])).rows.length, 3);
});
test('refund-before-capture delivery records both facts atomically and never exposes an active entitlement', async () => {
  const record = await bill('outoforder'); const paymentId = 'pay_outoforder';
  gatewayPayments.set(paymentId, { id: paymentId, order_id: record.provider_order_id, amount: record.quote.buyer_total, currency: 'INR', status: 'refunded', captured: true });
  gatewayRefunds.set('rfnd_outoforder', { id: 'rfnd_outoforder', payment_id: paymentId, amount: record.quote.buyer_total, status: 'processed' });
  assert.equal((await notify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_outoforder' } } } })).status, 200);
  assert.equal((await stored(record.id)).status, 'refunded');
  assert.equal((await db.query('SELECT * FROM billing_entitlements WHERE billing_id=$1 AND expires_at>now()', [record.id])).rows.length, 0);
});
