import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Disposable PostgreSQL only: no environment files or hosted database records.
const db = new PGlite();
const campus = randomUUID(), otherCampus = randomUUID();
let seller: string, buyer: string, peer: string, outsider: string, admin: string;
let baseDate: string, legacyListing: string, legacyOrder: string;
type StoredOrder = { id: string; buyer_id: string; seller_id: string; college_id: string; kind: string; amount: number; status: string; starts_on: string; ends_on: string; starts_at: Date | null; ends_at: Date | null; terms_snapshot: Record<string, unknown> };

async function member(values: { role?: string; verified?: boolean; suspended?: boolean; college_id?: string | null } = {}) {
  const id = randomUUID();
  await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [id, 'Rental test member', id + '@example.test']);
  await db.query('UPDATE profiles SET role=$2,verified=$3,suspended=$4,college_id=$5 WHERE id=$1', [id, values.role ?? 'student', values.verified ?? true, values.suspended ?? false, values.college_id === undefined ? campus : values.college_id]);
  return id;
}

async function asUser<T>(actor: string | null, work: () => Promise<T>): Promise<T> {
  await db.exec('BEGIN; SET LOCAL ROLE unicirq_app;');
  try {
    if (actor) await db.query("SELECT set_config('app.user_id',$1,true)", [actor]);
    const result = await work();
    await db.exec('COMMIT');
    return result;
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}

async function command(actor: string | null, payload: object) {
  return asUser(actor, async () => (await db.query<{ result: { id: string } }>('SELECT unicirq_command($1::jsonb) AS result', [JSON.stringify(payload)])).rows[0].result);
}

const listingInput = (unit = 'day', overrides: Record<string, unknown> = {}) => ({ type: 'create_listing', title: 'Campus camera rental', description: 'A working camera with its charger for a campus pickup.', kind: 'rental', category: 'Electronics', price: 12345, unit, condition: 'Good', location: 'Main library entrance', ...overrides });
const date = (days = 0) => new Date(Date.parse(baseDate + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const instant = (clock = '10:00:00', days = 0) => date(days) + 'T' + clock + '+05:30';
const dates = (days = 1, start = 0) => ({ starts_on: date(start), ends_on: date(start + days) });
const times = (start = '10:00:00', end = '11:00:00', day = 0) => ({ starts_at: instant(start, day), ends_at: instant(end, day) });
const createListing = (unit = 'day', overrides: Record<string, unknown> = {}) => command(seller, listingInput(unit, overrides));
const createOrder = (listing: string, interval: object, actor = buyer, overrides: Record<string, unknown> = {}) => command(actor, { type: 'create_order', listing_id: listing, ...interval, ...overrides });
const transition = (order: string, status: string, actor = seller) => command(actor, { type: 'transition_order', order_id: order, status });
async function stored(order: string) { return (await db.query<StoredOrder>('SELECT id,buyer_id,seller_id,college_id,kind,amount,status,starts_on::text,ends_on::text,starts_at,ends_at,terms_snapshot FROM orders WHERE id=$1', [order])).rows[0]; }

before(async () => {
  const migrations = (await readdir('database/migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  for (const file of migrations.filter(name => name < '012_')) await db.exec(await readFile('database/migrations/' + file, 'utf8'));
  for (const [id, name] of [[campus, 'Rental test campus'], [otherCampus, 'Other rental campus']]) await db.query('INSERT INTO colleges(id,name,short_name,domain,city) VALUES($1,$2,$2,$3,$4)', [id, name, id + '.example.test', 'Test city']);
  seller = await member(); buyer = await member(); peer = await member(); outsider = await member({ college_id: otherCampus }); admin = await member({ role: 'admin' });
  baseDate = (await db.query<{ day: string }>("SELECT ((now() AT TIME ZONE 'Asia/Kolkata')::date+2)::text AS day")).rows[0].day;
  legacyListing = (await createListing()).id;
  legacyOrder = (await createOrder(legacyListing, dates(2, 5))).id;
  await transition(legacyOrder, 'accepted');
  for (const file of migrations.filter(name => name >= '012_')) await db.exec(await readFile('database/migrations/' + file, 'utf8'));
});

after(async () => { await db.close(); });

test('rental migration retains existing date-only reservations and original terms', async () => {
  const row = await stored(legacyOrder);
  assert.equal(row.starts_at, null); assert.equal(row.ends_at, null);
  assert.equal(row.starts_on, date(5)); assert.equal(row.ends_on, date(7));
  assert.equal(Number(row.amount), 24690); assert.equal(row.terms_snapshot.unit, 'day');
  assert.equal(row.terms_snapshot.billing_units, undefined);
  await assert.rejects(() => createOrder(legacyListing, dates(1, 6), peer), /reserved/);
  const adjacent = await createOrder(legacyListing, dates(1, 7), peer);
  await transition(adjacent.id, 'accepted');
});

test('SQL creates hour, day, week and month listings without widening other kinds', async () => {
  for (const unit of ['hour', 'day', 'week', 'month']) {
    const listing = await createListing(unit, { owner_id: admin, college_id: otherCampus });
    const row = (await db.query<{ unit: string; owner_id: string; college_id: string }>('SELECT unit,owner_id,college_id FROM listings WHERE id=$1', [listing.id])).rows[0];
    assert.deepEqual(row, { unit, owner_id: seller, college_id: campus });
  }
  for (const unit of ['item', 'session', 'project', '', null]) await assert.rejects(() => createListing(unit as string), /Invalid pricing unit/);
  for (const kind of ['sale', 'hardware', 'service']) for (const unit of ['day', 'week', 'month']) await assert.rejects(() => createListing(unit, { kind }), /Invalid pricing unit/);
});

test('hourly billing rounds partial hours upward, permits same-day rentals and derives IST dates', async () => {
  for (const [interval, units] of [[times('10:00:00', '10:01:00'), 1], [times('10:00:00', '11:00:00'), 1], [times('10:00:00', '11:00:01'), 2]] as const) {
    const listing = await createListing('hour');
    const request = await createOrder(listing.id, interval);
    const row = await stored(request.id);
    assert.equal(row.starts_on, date()); assert.equal(row.ends_on, date());
    assert.equal(new Date(row.starts_at!).toISOString(), new Date(interval.starts_at).toISOString());
    assert.equal(row.terms_snapshot.billing_units, units); assert.equal(Number(row.amount), 12345 * units);
  }
  const listing = await createListing('hour');
  const request = await createOrder(listing.id, { starts_at: date() + 'T20:00:00Z', ends_at: date() + 'T21:30:00Z', starts_on: '2000-01-01', ends_on: '2000-01-02' });
  const row = await stored(request.id);
  assert.equal(row.starts_on, date(1)); assert.equal(row.ends_on, date(1));
  assert.equal(row.terms_snapshot.billing_units, 2);
  const longest = await createListing('hour');
  const maximum = await createOrder(longest.id, { starts_at: instant(), ends_at: instant('10:00:00', 30) });
  assert.equal((await stored(maximum.id)).terms_snapshot.billing_units, 720);
});

test('day, week and fixed thirty-day month pricing uses server-owned rounded billing units', async () => {
  for (const [unit, duration, units] of [['day', 3, 3], ['week', 1, 1], ['week', 7, 1], ['week', 8, 2], ['week', 30, 5], ['month', 1, 1], ['month', 30, 1]] as const) {
    const listing = await createListing(unit);
    const request = await createOrder(listing.id, dates(duration), buyer, { amount: 0, price: 1, unit: 'item', billing_units: 0, buyer_id: admin, seller_id: peer, college_id: otherCampus, terms_snapshot: { price: 0, unit: 'item', protected: true }, starts_at: instant('15:00:00'), ends_at: instant('16:00:00') });
    const row = await stored(request.id);
    assert.equal(Number(row.amount), 12345 * units);
    assert.equal(row.terms_snapshot.unit, unit); assert.equal(row.terms_snapshot.price, 12345); assert.equal(row.terms_snapshot.billing_units, units);
    assert.equal(row.terms_snapshot.billing_period_days, unit === 'month' ? 30 : null);
    assert.equal(row.terms_snapshot.payment_mode, 'direct'); assert.equal(row.terms_snapshot.protected, false);
    assert.equal(row.buyer_id, buyer); assert.equal(row.seller_id, seller); assert.equal(row.college_id, campus);
    assert.equal(new Date(row.starts_at!).toISOString(), new Date(instant('00:00:00')).toISOString());
    assert.equal(new Date(row.ends_at!).toISOString(), new Date(instant('00:00:00', duration)).toISOString());
  }
});

test('rental creation rejects missing, past, zero, reversed, oversized and timezone-less intervals', async () => {
  const hourly = await createListing('hour');
  const invalidHours = [
    {}, { ...times(), starts_at: null }, { ...times(), ends_at: null },
    { ...times(), starts_at: date() + 'T10:00:00' }, { ...times(), starts_at: date() + ' 10:00:00+05:30' },
    { ...times(), starts_at: date() + 'T24:00:00+05:30' }, { ...times(), starts_at: '2030-02-30T10:00:00+05:30' },
    { ...times(), starts_at: 'infinity' }, times('11:00:00', '11:00:00'), times('12:00:00', '11:00:00'),
    { starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: instant() },
    { starts_at: instant(), ends_at: instant('10:00:01', 30) },
    { starts_on: date(), ends_on: date(1) },
  ];
  for (const interval of invalidHours) await assert.rejects(() => createOrder(hourly.id, interval));
  assert.equal((await db.query('SELECT * FROM orders WHERE listing_id=$1', [hourly.id])).rows.length, 0);
  for (const unit of ['day', 'week', 'month']) {
    const listing = await createListing(unit);
    for (const interval of [{}, dates(0), dates(-1), dates(31), { ...dates(), starts_on: null }, { ...dates(), ends_on: null }, { ...dates(), starts_on: '2000-01-01' }, { ...dates(), starts_on: '2030-02-30' }, times()]) await assert.rejects(() => createOrder(listing.id, interval));
    assert.equal((await db.query('SELECT * FROM orders WHERE listing_id=$1', [listing.id])).rows.length, 0);
  }
});

test('hourly creation and acceptance use timestamp overlaps, with adjacent slots allowed', async () => {
  const listing = await createListing('hour');
  const first = await createOrder(listing.id, times('10:00:00', '12:00:00'));
  const pending = await createOrder(listing.id, times('11:00:00', '13:00:00'), peer);
  await transition(first.id, 'accepted');
  await assert.rejects(() => transition(pending.id, 'accepted'), /reserves this item/);
  assert.equal((await stored(pending.id)).status, 'requested');
  assert.equal((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM order_events WHERE order_id=$1', [pending.id])).rows[0].count, 1);
  await assert.rejects(async () => createOrder(listing.id, times('11:30:00', '12:30:00'), await member()), /reserved/);
  const adjacent = await createOrder(listing.id, times('12:00:00', '13:00:00'), await member());
  await transition(adjacent.id, 'accepted');
  await assert.rejects(() => createOrder(listing.id, times('13:00:00', '14:00:00')), /active request/);
});

test('hourly overlap checks include legacy date-only reservations at IST midnight', async () => {
  await db.query("UPDATE listings SET unit='hour' WHERE id=$1", [legacyListing]);
  await assert.rejects(async () => createOrder(legacyListing, times('00:00:00', '01:00:00', 5), await member()), /reserved/);
  // Immediately after the legacy [day 5, day 7) period is available.
  const after = await createOrder(legacyListing, times('00:00:00', '01:00:00', 8), await member());
  await transition(after.id, 'accepted');
  await assert.rejects(async () => createOrder(legacyListing, times('00:30:00', '01:30:00', 8), await member()), /reserved/);
});

test('new requested rentals cannot be accepted across an inserted legacy reservation', async () => {
  const listing = await createListing('hour');
  const request = await createOrder(listing.id, times('10:00:00', '11:00:00'));
  await db.query(`INSERT INTO orders(listing_id,buyer_id,seller_id,college_id,amount,kind,starts_on,ends_on,status,terms_snapshot)
    VALUES($1,$2,$3,$4,100,'rental',$5,$6,'accepted','{"unit":"day","price":100}')`, [listing.id, await member(), seller, campus, date(), date(1)]);
  await assert.rejects(() => transition(request.id, 'accepted'), /reserves this item/);
  assert.equal((await stored(request.id)).status, 'requested');
});

test('rental terms survive price edits and handover, return and precise notifications remain intact', async () => {
  const listing = await createListing('week');
  const request = await createOrder(listing.id, dates(8));
  const initial = await stored(request.id);
  await db.query("UPDATE listings SET price=99999,unit='month',title='Changed rental title' WHERE id=$1", [listing.id]);
  await transition(request.id, 'accepted');
  await transition(request.id, 'handed_over', buyer);
  await transition(request.id, 'completed');
  const final = await stored(request.id);
  assert.equal(Number(final.amount), 24690); assert.deepEqual(final.terms_snapshot, initial.terms_snapshot);
  assert.equal(final.status, 'completed');
  assert.equal((await db.query<{ status: string }>('SELECT status FROM listings WHERE id=$1', [listing.id])).rows[0].status, 'active');
  assert.deepEqual((await db.query<{ status: string }>('SELECT status FROM order_events WHERE order_id=$1 ORDER BY created_at,id', [request.id])).rows.map(row => row.status), ['requested', 'accepted', 'handed_over', 'completed']);
  const notices = (await db.query<{ user_id: string; href: string }>('SELECT user_id,href FROM notifications WHERE href=$1', ['/student/activity?order=' + request.id])).rows;
  assert.equal(notices.length, 4); assert.ok(notices.every(row => [buyer, seller].includes(row.user_id)));
});

test('listing and order commands independently enforce verified student, campus, ownership and active inventory', async () => {
  const listing = await createListing('hour');
  for (const actor of [null, admin, await member({ role: 'business' }), await member({ verified: false }), await member({ suspended: true }), await member({ verified: false, college_id: null })]) {
    await assert.rejects(() => command(actor, listingInput('week')), /active account|Verified student/);
    await assert.rejects(() => command(actor, { type: 'create_order', listing_id: listing.id, ...times() }), /active account|Verified student/);
  }
  for (const actor of [seller, outsider]) await assert.rejects(() => createOrder(listing.id, times(), actor), /not allowed/);
  const order = await createOrder(listing.id, times());
  for (const actor of [peer, admin, outsider]) await assert.rejects(() => transition(order.id, 'accepted', actor), /private|Verified student/);
  await assert.rejects(() => transition(order.id, 'accepted', buyer), /Invalid activity transition/);
  await db.query("UPDATE listings SET status='closed' WHERE id=$1", [listing.id]);
  await assert.rejects(() => transition(order.id, 'accepted'), /no longer available/);
  await assert.rejects(() => createOrder(listing.id, times(), peer), /not allowed/);
});

test('rental table guard prevents malformed and missing precise hourly periods while preserving legacy rows', async () => {
  const listing = await createListing('hour');
  for (const values of [
    [date(), date(), null, null, { unit: 'hour' }],
    [date(), date(1), instant(), null, { unit: 'hour' }],
    [date(), date(), instant(), instant(), { unit: 'hour' }],
    [date(), date(1), instant(), instant('11:00:00'), { unit: 'hour' }],
    [date(), date(31), instant(), instant('10:00:00', 31), { unit: 'hour' }],
    [date(), date(), instant(), instant('11:00:00'), {}],
    [date(), date(1), instant(), instant('11:00:00', 1), { unit: 'day' }],
  ]) {
    await assert.rejects(() => db.query(`INSERT INTO orders(listing_id,buyer_id,seller_id,college_id,amount,kind,starts_on,ends_on,starts_at,ends_at,terms_snapshot)
      VALUES($1,$2,$3,$4,100,'rental',$5,$6,$7,$8,$9::jsonb)`, [listing.id, buyer, seller, campus, ...values.slice(0, 4), JSON.stringify(values[4])]), /orders_rental_period_check/);
  }
});

test('photo listing entry point supports rental periods and protects identity and photo atomicity', async () => {
  const photo = Buffer.alloc(24); photo.write('RIFF'); photo.writeUInt32LE(16, 4); photo.write('WEBP', 8);
  const result = await asUser(seller, async () => (await db.query<{ result: { id: string } }>('SELECT app_create_listing_with_photo($1::jsonb,$2::bytea) AS result', [JSON.stringify(listingInput('month', { owner_id: admin })), photo])).rows[0].result);
  assert.equal((await db.query<{ unit: string }>('SELECT unit FROM listings WHERE id=$1', [result.id])).rows[0].unit, 'month');
  assert.equal((await db.query('SELECT * FROM listing_photos WHERE listing_id=$1', [result.id])).rows.length, 1);
  await assert.rejects(() => asUser(seller, () => db.query('SELECT app_create_listing_with_photo($1::jsonb,$2::bytea)', [JSON.stringify(listingInput('week', { kind: 'sale' })), photo])), /Invalid pricing unit/);
});

test('rental gateway retains shared rate limits, command delegation and owner-only legacy functions', async () => {
  const actor = await member();
  for (let index = 0; index < 59; index++) await command(actor, { type: 'read_notifications' });
  await command(actor, listingInput('hour'));
  await assert.rejects(() => command(actor, listingInput('day')), /wait a minute/);
  await assert.rejects(() => command(actor, { type: 'read_notifications' }), /wait a minute/);
  assert.equal((await db.query<{ request_count: number }>('SELECT request_count FROM action_limits WHERE user_id=$1', [actor])).rows[0].request_count, 60);
  await assert.rejects(() => asUser(actor, () => db.query('SELECT app_command_before_rental_periods($1::jsonb)', [JSON.stringify(listingInput('hour'))])), /permission denied/);
  await assert.rejects(() => asUser(actor, () => db.query("UPDATE orders SET amount=0 WHERE buyer_id=$1", [actor])), /permission denied/);
  const functionRows = (await db.query<{ name: string; allowed: boolean; public_execute: boolean; definer: boolean; settings: string[] }>(`SELECT p.proname AS name,
    has_function_privilege('unicirq_app',p.oid,'EXECUTE') AS allowed,
    EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) privilege WHERE privilege.grantee=0 AND privilege.privilege_type='EXECUTE') AS public_execute,
    p.prosecdef AS definer,p.proconfig AS settings FROM pg_proc p
    WHERE p.proname='unicirq_command' OR p.proname LIKE 'app_command_before_%'`)).rows;
  for (const row of functionRows) { assert.equal(row.allowed, row.name === 'unicirq_command'); assert.equal(row.public_execute, false); assert.equal(row.definer, true); assert.ok(row.settings.some(value => value.replace(/\s/g, '') === 'search_path=public,pg_temp')); }
});
