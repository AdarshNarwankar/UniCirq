import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { calculateBillingQuote, type BillingRecord, type BillingQuote, type BillingSelection } from '../src/lib/billing';

// All credentials, payments and records in these tests are disposable fixtures.
// No environment file, gateway call, real email or hosted database is used.
const db = new PGlite();
const campus = randomUUID(), otherCampus = randomUUID();
let buyer: string, seller: string, peer: string, outsider: string, admin: string, business: string, unverified: string, suspended: string;

async function member(values: { role?: string; college?: string; verified?: boolean; suspended?: boolean } = {}) {
  const id = randomUUID();
  await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [id, 'Billing test member', id + '@example.test']);
  await db.query('UPDATE profiles SET role=$2,college_id=$3,verified=$4,suspended=$5 WHERE id=$1', [id, values.role ?? 'student', values.college ?? campus, values.verified ?? true, values.suspended ?? false]);
  return id;
}
async function role<T>(selected: 'unicirq_app' | 'unicirq_billing_backend', actor: string | null, run: () => Promise<T>) {
  await db.exec('BEGIN; SET LOCAL ROLE ' + selected);
  try {
    if (actor) await db.query("SELECT set_config('app.user_id',$1,true)", [actor]);
    const result = await run(); await db.exec('COMMIT'); return result;
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
const asUser = <T>(actor: string | null, run: () => Promise<T>) => role('unicirq_app', actor, run);
const asBackend = <T>(run: () => Promise<T>) => role('unicirq_billing_backend', null, run);
async function jsonResult<T>(sql: string, values: unknown[] = []) { return (await db.query<{ result: T }>(sql + ' AS result', values)).rows[0].result; }
const quote = (actor: string | null, input: object) => asUser(actor, () => jsonResult<BillingQuote>('SELECT app_billing_quote($1::jsonb)', [JSON.stringify(input)]));
const create = (actor: string | null, input: object) => asUser(actor, () => jsonResult<BillingRecord>('SELECT app_billing_create($1::jsonb)', [JSON.stringify(input)]));
const configure = (actor: string | null, tax: number | null, pilot = true) => asUser(actor, () => jsonResult('SELECT app_billing_configure($1::jsonb)', [JSON.stringify({ tax_bps: tax, business_pilot: pilot, reason: 'Confirm controlled test billing settings' })]));
const attach = (id: string, providerOrder: string) => asBackend(() => jsonResult<BillingRecord>('SELECT app_billing_attach($1,$2)', [id, providerOrder]));
const capture = (bill: BillingRecord, payment = 'pay_' + randomUUID().replaceAll('-', ''), event = 'capture:' + randomUUID(), amount = bill.quote.buyer_total!, currency = 'INR', providerOrder = bill.provider_order_id) => asBackend(() => jsonResult<BillingRecord>('SELECT app_billing_capture($1,$2,$3,$4,$5,$6)', [bill.id, providerOrder, payment, amount, currency, event]));
const refund = (bill: BillingRecord, amount: number, event = 'refund:rfnd_' + randomUUID().replaceAll('-', '')) => asBackend(() => jsonResult<BillingRecord>('SELECT app_billing_refund($1,$2,$3,$4)', [bill.id, bill.provider_payment_id, amount, event]));

async function listing(kind = 'sale', amount = 100000, owner = seller) {
  const id = randomUUID();
  await db.query(`INSERT INTO listings(id,owner_id,college_id,title,description,kind,category,price,unit,condition,location)
   VALUES($1,$2,$3,'Billing fixture listing','A disposable campus listing for billing tests.',$4,'Electronics',$5,$6,'Good','Campus test meet point')`, [id, owner, owner === outsider ? otherCampus : campus, kind, amount, kind === 'rental' ? 'day' : kind === 'service' ? 'hour' : 'item']);
  return id;
}
async function order(kind = 'sale', amount = 100000, status = 'accepted', requester = buyer) {
  const id = randomUUID(), listingId = await listing(kind, amount);
  const start = kind === 'rental' ? '2030-01-02' : null, end = kind === 'rental' ? '2030-01-03' : null;
  await db.query(`INSERT INTO orders(id,listing_id,buyer_id,seller_id,college_id,status,amount,kind,starts_on,ends_on,terms_snapshot)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, listingId, requester, seller, campus, status, amount, kind, start, end, JSON.stringify({ title: 'Billing fixture', description: 'An unchanged original exchange.', unit: kind === 'rental' ? 'day' : 'item', price: amount, payment_mode: 'direct', protected: false })]);
  return id;
}
const selection = (id: string, payment_mode: 'checkout' | 'direct' = 'checkout'): BillingSelection => ({ purpose: 'order', reference_id: id, payment_mode });
async function paidBoost() {
  await configure(admin, 0);
  const id = await listing();
  const created = await create(seller, { purpose: 'boost', reference_id: id, payment_mode: 'checkout' });
  const attached = await attach(created.id, 'order_' + randomUUID().replaceAll('-', ''));
  return capture(attached);
}

before(async () => {
  for (const file of (await readdir('database/migrations')).filter(file => /^\d+_.+\.sql$/.test(file)).sort()) await db.exec(await readFile('database/migrations/' + file, 'utf8'));
  for (const [id, name] of [[campus, 'Billing campus'], [otherCampus, 'Other billing campus']]) await db.query('INSERT INTO colleges(id,name,short_name,domain,city) VALUES($1,$2,$2,$3,$4)', [id, name, id + '.example.test', 'Test city']);
  buyer = await member(); seller = await member(); peer = await member(); outsider = await member({ college: otherCampus });
  admin = await member({ role: 'admin' }); business = await member({ role: 'business' }); unverified = await member({ verified: false }); suspended = await member({ suspended: true });
  await db.query(`INSERT INTO business_profiles(owner_id,college_id,name,category,description,location,verified)
   VALUES($1,$2,'Billing fixture business','Campus services','A business used only by isolated billing tests.','Campus test location',true)`, [business, campus]);
});
after(async () => { await db.close(); });

test('SQL quotes match integer pricing for every exchange kind and taxes, without trusting client amounts', async () => {
  for (const rate of [0, 1800, null]) {
    await configure(admin, rate);
    for (const kind of ['sale', 'hardware', 'rental', 'service'] as const) {
      for (const amount of [0, 20000, 100001]) {
        const id = await order(kind, amount);
        for (const payment_mode of ['direct', 'checkout'] as const) {
          const actual = await quote(buyer, selection(id, payment_mode));
          const expected = calculateBillingQuote({ purpose: 'order', kind, amount, payment_mode, tax_bps: rate, business_pilot: true });
          assert.deepEqual(actual, expected);
        }
      }
    }
  }
  const id = await order();
  for (const forged of [{ amount: 1 }, { owner_id: admin }, { tax_bps: 0 }, { deposit_amount: 10000 }, { status: 'paid' }, { plan: 'growth' }]) await assert.rejects(() => quote(buyer, { ...selection(id), ...forged }), /Invalid billing request|Student order/);
});

test('paid test quotes require explicit tax setup while direct and pilot records remain free', async () => {
  await configure(admin, null, true);
  const id = await order();
  assert.equal((await quote(buyer, selection(id))).buyer_total, null);
  await assert.rejects(() => create(buyer, selection(id)), /Tax settings/);
  const direct = await create(buyer, selection(id, 'direct'));
  assert.equal(direct.status, 'recorded'); assert.equal(direct.quote.platform_fee, 0); assert.equal(direct.paid_at, null);
  const pilot = await create(business, { purpose: 'business_plan', plan: 'featured', payment_mode: 'checkout' });
  assert.equal(pilot.status, 'recorded'); assert.equal(pilot.quote.buyer_total, 0); assert.equal(pilot.quote.base_amount, 49900); assert.equal(pilot.quote.pilot_waived, true);
  const access = (await asUser(business, () => db.query<{ feature: string; days: number }>("SELECT feature,extract(epoch FROM expires_at-starts_at)/86400 AS days FROM billing_entitlements WHERE billing_id=$1", [pilot.id]))).rows[0];
  assert.equal(access.feature, 'featured'); assert.ok(Number(access.days) >= 28 && Number(access.days) <= 31);
  assert.equal((await create(business, { purpose: 'business_plan', plan: 'featured', payment_mode: 'checkout' })).id, pilot.id);
});

test('billing roles, selected campus, accepted order ownership and provider net are enforced independently in SQL', async () => {
  await configure(admin, 1800);
  const id = await order();
  for (const actor of [null, seller, peer, outsider, business, admin, unverified, suspended]) await assert.rejects(() => quote(actor, selection(id)), /active|Verified|Student|buyer/);
  for (const state of ['requested', 'cancelled', 'disputed', 'completed', 'handed_over']) {
    const reference = await order('sale', 100000, state);
    await assert.rejects(() => quote(buyer, selection(reference)), /accepted/);
  }
  const ownListing = await listing();
  for (const actor of [buyer, outsider, business, admin, unverified, suspended]) await assert.rejects(() => quote(actor, { purpose: 'boost', reference_id: ownListing, payment_mode: 'checkout' }), /active|Verified|Student|own/);
  for (const actor of [buyer, seller, admin, outsider]) await assert.rejects(() => quote(actor, { purpose: 'business_plan', plan: 'growth', payment_mode: 'checkout' }), /business/);
  for (const amount of [1000, 1900, 2200]) {
    const reference = await order('service', amount);
    await assert.rejects(() => quote(buyer, selection(reference)), /cover/);
  }
  const affordable = await quote(buyer, selection(await order('service', 50000)));
  assert.equal(affordable.buyer_total, 50000); assert.equal(affordable.platform_fee, 4000); assert.equal(affordable.tax_amount, 720); assert.equal(affordable.seller_net, 45280);
});

test('direct summaries and optional checkout each have one stable order record without duplicate fees', async () => {
  await configure(admin, 0);
  const id = await order();
  const direct = await create(buyer, selection(id, 'direct'));
  const checkout = await create(buyer, selection(id));
  assert.notEqual(checkout.id, direct.id);
  assert.equal((await create(buyer, selection(id, 'direct'))).id, direct.id);
  assert.equal((await create(buyer, selection(id))).id, checkout.id);
  const attached = await attach(checkout.id, 'order_uniqueOne');
  const paid = await capture(attached);
  assert.equal((await create(buyer, selection(id))).id, paid.id);
  assert.equal(Number((await db.query<{ count: number }>('SELECT count(*) AS count FROM billing_records WHERE reference_id=$1', [id])).rows[0].count), 2);
});

test('app and PUBLIC callers cannot write records, alter settings, grant access or forge gateway confirmation', async () => {
  const id = await order();
  const record = await create(buyer, selection(id));
  await assert.rejects(() => asUser(buyer, () => db.query("UPDATE billing_records SET status='paid' WHERE id=$1", [record.id])), /permission/);
  await assert.rejects(() => asUser(admin, () => db.exec('UPDATE billing_settings SET tax_bps=0')), /permission/);
  for (const sql of [
    "SELECT app_billing_attach($1,'order_forged')", "SELECT app_billing_capture($1,'order_forged','pay_forged',100,'INR','fake:event')",
    "SELECT app_billing_refund($1,'pay_forged',100,'refund:forged')", 'SELECT app_billing_grant($1)', 'SELECT app_billing_backend_record($1)',
  ]) await assert.rejects(() => asUser(admin, () => db.query(sql, [record.id])), /permission/);
  await assert.rejects(() => asUser(admin, () => db.exec("SELECT app_billing_limit('fake:bucket',1,60)")), /permission/);
  const publicGrants = await db.query(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname LIKE 'app_billing_%' AND EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) grants WHERE grants.grantee=0 AND grants.privilege_type='EXECUTE')`);
  assert.equal(publicGrants.rows.length, 0);
  assert.equal((await db.query<{ status: string }>('SELECT status FROM billing_records WHERE id=$1', [record.id])).rows[0].status, 'quoted');
});

test('capture binds amount, currency and stored order and is idempotent across verifier and webhook retries', async () => {
  await configure(admin, 0);
  const record = await create(buyer, selection(await order()));
  const attached = await attach(record.id, 'order_verifiedCapture');
  await assert.rejects(() => capture(attached, 'pay_wrongAmount', 'capture:wrongAmount', 1), /does not match/);
  await assert.rejects(() => capture(attached, 'pay_wrongCurrency', 'capture:wrongCurrency', attached.quote.buyer_total!, 'USD'), /does not match/);
  await assert.rejects(() => capture(attached, 'pay_wrongOrder', 'capture:wrongOrder', attached.quote.buyer_total!, 'INR', 'order_unrelated'), /does not match/);
  assert.equal(Number((await db.query<{ count: number }>('SELECT count(*) AS count FROM billing_events WHERE billing_id=$1', [record.id])).rows[0].count), 0);
  const paid = await capture(attached, 'pay_verifiedCapture', 'verify:pay_verifiedCapture');
  assert.equal(paid.status, 'paid');
  const auditCount = Number((await db.query<{ count: number }>("SELECT count(*) AS count FROM audit_logs WHERE target_id=$1 AND action='billing.test_paid'", [record.id])).rows[0].count);
  const replay = await capture(attached, 'pay_verifiedCapture', 'verify:pay_verifiedCapture');
  const webhook = await capture(attached, 'pay_verifiedCapture', 'webhook:evt_capture');
  assert.equal(replay.id, paid.id); assert.equal(webhook.id, paid.id);
  assert.equal(Number((await db.query<{ count: number }>("SELECT count(*) AS count FROM audit_logs WHERE target_id=$1 AND action='billing.test_paid'", [record.id])).rows[0].count), auditCount);
  await assert.rejects(() => capture(attached, 'pay_secondCapture'), /another captured/);
});

test('quote snapshots freeze tax settings once a provider order is attached, including late capture', async () => {
  await configure(admin, 0);
  const id = await order();
  const record = await create(buyer, selection(id));
  await db.query("UPDATE billing_records SET expires_at=now()-interval '1 minute' WHERE id=$1", [record.id]);
  await assert.rejects(() => attach(record.id, 'order_expired'), /expired/);
  await configure(admin, 1800);
  const refreshed = await create(buyer, selection(id));
  assert.equal(refreshed.id, record.id); assert.equal(refreshed.quote.tax_amount, 900);
  const attached = await attach(record.id, 'order_lateCaptured');
  await db.query("UPDATE billing_records SET expires_at=now()-interval '1 minute' WHERE id=$1", [record.id]);
  await configure(admin, 0);
  const unchanged = await create(buyer, selection(id));
  assert.equal(unchanged.quote.tax_amount, 900);
  await configure(admin, null);
  assert.equal((await create(buyer, selection(id))).quote.tax_amount, 900);
  assert.equal((await capture(attached)).status, 'paid');
});

test('capture rolls back payment, events and notifications if entitlement creation cannot complete', async () => {
  await configure(admin, 0);
  const created = await create(seller, { purpose: 'boost', reference_id: await listing(), payment_mode: 'checkout' });
  const attached = await attach(created.id, 'order_atomicBoost');
  await db.exec("ALTER TABLE billing_entitlements ADD CONSTRAINT billing_test_entitlement_failure CHECK(feature<>'listing_boost') NOT VALID");
  try { await assert.rejects(() => capture(attached, 'pay_atomicBoost', 'capture:atomicBoost'), /billing_test_entitlement_failure/); }
  finally { await db.exec('ALTER TABLE billing_entitlements DROP CONSTRAINT billing_test_entitlement_failure'); }
  assert.equal((await db.query<{ status: string }>('SELECT status FROM billing_records WHERE id=$1', [created.id])).rows[0].status, 'pending');
  assert.equal(Number((await db.query<{ count: number }>('SELECT count(*) AS count FROM billing_events WHERE billing_id=$1', [created.id])).rows[0].count), 0);
  assert.equal(Number((await db.query<{ count: number }>('SELECT count(*) AS count FROM audit_logs WHERE target_id=$1', [created.id])).rows[0].count), 0);
  assert.equal((await capture(attached, 'pay_atomicBoost', 'capture:atomicBoost')).status, 'paid');
});

test('paid boosts grant one seven-day test entitlement while paid plans use a calendar month', async () => {
  const bill = await paidBoost();
  const rows = (await db.query<{ provider_mode: string; feature: string; seconds: number }>('SELECT provider_mode,feature,extract(epoch FROM expires_at-starts_at) AS seconds FROM billing_entitlements WHERE billing_id=$1', [bill.id])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].provider_mode, 'test'); assert.equal(rows[0].feature, 'listing_boost'); assert.equal(Number(rows[0].seconds), 7 * 86400);
  await capture(bill, bill.provider_payment_id!, 'webhook:boostReplay');
  assert.equal(Number((await db.query<{ count: number }>('SELECT count(*) AS count FROM billing_entitlements WHERE billing_id=$1', [bill.id])).rows[0].count), 1);
  await configure(admin, 1800, false);
  const selected = { purpose: 'business_plan', plan: 'growth', payment_mode: 'checkout' };
  const plan = await create(business, selected);
  assert.equal(plan.quote.platform_fee, 99900); assert.equal(plan.quote.tax_amount, 17982); assert.equal(plan.quote.buyer_total, 117882);
  const paid = await capture(await attach(plan.id, 'order_growthMonth'));
  const period = (await db.query<{ correct: boolean; feature: string }>("SELECT feature,expires_at=((starts_at AT TIME ZONE 'Asia/Kolkata')+interval '1 month') AT TIME ZONE 'Asia/Kolkata' AS correct FROM billing_entitlements WHERE billing_id=$1", [paid.id])).rows[0];
  assert.equal(period.feature, 'growth'); assert.equal(period.correct, true);
});

test('refund events reconcile partial and full refunds once, revoke test access and never change exchange state', async () => {
  const bill = await paidBoost();
  const event = 'refund:rfnd_partialOne';
  const partial = await refund(bill, 1000, event);
  assert.equal(partial.status, 'paid'); assert.equal(Number(partial.refunded_amount), 1000);
  assert.equal(Number((await refund(bill, 1000, event)).refunded_amount), 1000);
  await assert.rejects(() => refund(bill, 999, event), /does not match/);
  await assert.rejects(() => refund(bill, 2000), /exceeds/);
  const full = await refund(bill, 1900);
  assert.equal(full.status, 'refunded'); assert.equal(Number(full.refunded_amount), 2900);
  assert.equal((await db.query<{ active: boolean }>('SELECT expires_at>now() AS active FROM billing_entitlements WHERE billing_id=$1', [bill.id])).rows[0].active, false);
  const recaptured = await capture(bill, bill.provider_payment_id!, 'webhook:latePaymentReplay');
  assert.equal(recaptured.status, 'refunded');
  await assert.rejects(() => refund(bill, 1), /exceeds/);
  const orderId = await order(), charge = await create(buyer, selection(orderId));
  const paid = await capture(await attach(charge.id, 'order_exchangeRefund'));
  await refund(paid, paid.quote.buyer_total!);
  assert.equal((await db.query<{ status: string }>('SELECT status FROM orders WHERE id=$1', [orderId])).rows[0].status, 'accepted');
});

test('billing RLS exposes only owned or beneficiary history, never another campus or private provider controls', async () => {
  await configure(admin, 0);
  const bill = await create(buyer, selection(await order()));
  for (const actor of [buyer, seller, admin]) assert.equal((await asUser(actor, () => db.query('SELECT id FROM billing_records WHERE id=$1', [bill.id]))).rows.length, 1);
  for (const actor of [null, peer, outsider, business, suspended]) assert.equal((await asUser(actor, () => db.query('SELECT id FROM billing_records WHERE id=$1', [bill.id]))).rows.length, 0);
  const paid = await paidBoost();
  for (const actor of [buyer, peer, outsider, business, null]) {
    assert.equal((await asUser(actor, () => db.query('SELECT id FROM billing_events WHERE billing_id=$1', [paid.id]))).rows.length, 0);
    assert.equal((await asUser(actor, () => db.query('SELECT id FROM billing_entitlements WHERE billing_id=$1', [paid.id]))).rows.length, 0);
  }
  assert.ok((await asUser(seller, () => db.query('SELECT id FROM billing_events WHERE billing_id=$1', [paid.id]))).rows.length > 0);
});

test('independent backend admission counts denied attempts and is unavailable to browser database identities', async () => {
  const key = 'billing:test:' + randomUUID();
  const limit = () => asBackend(() => jsonResult<boolean>('SELECT app_billing_limit($1,2,60)', [key]));
  assert.equal(await limit(), true); assert.equal(await limit(), true); assert.equal(await limit(), false); assert.equal(await limit(), false);
  assert.equal(Number((await db.query<{ count: number }>('SELECT count FROM billing_limits WHERE key=$1', [key])).rows[0].count), 4);
  await db.query("UPDATE billing_limits SET until_at=now()-interval '1 second' WHERE key=$1", [key]);
  assert.equal(await limit(), true);
  await assert.rejects(() => asUser(admin, () => db.query('SELECT * FROM billing_limits')), /permission/);
  await assert.rejects(() => asBackend(() => db.exec("SELECT app_billing_limit('invalid',0,60)")), /Invalid/);
});

test('settings updates require an administrator, a valid exact contract and an immutable audit reason', async () => {
  for (const actor of [null, buyer, seller, business, outsider, suspended]) await assert.rejects(() => configure(actor, 0), /Admin/);
  for (const payload of [
    { tax_bps: 1800, business_pilot: true, reason: '' }, { tax_bps: 10001, business_pilot: true, reason: 'Invalid tax setting' },
    { tax_bps: 18.5, business_pilot: true, reason: 'Invalid fractional tax setting' }, { tax_bps: 0, business_pilot: true, reason: 'Forged gateway setting', live_enabled: true },
  ]) await assert.rejects(() => asUser(admin, () => jsonResult('SELECT app_billing_configure($1::jsonb)', [JSON.stringify(payload)])), /reason|rate|basis-point/);
  await configure(admin, null, true);
  const row = (await db.query<{ tax_bps: number | null; business_pilot: boolean }>('SELECT tax_bps,business_pilot FROM billing_settings')).rows[0];
  assert.deepEqual(row, { tax_bps: null, business_pilot: true });
  assert.ok(Number((await db.query<{ count: number }>("SELECT count(*) AS count FROM audit_logs WHERE actor_id=$1 AND action='billing.configure'", [admin])).rows[0].count) > 0);
});
