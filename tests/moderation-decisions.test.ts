import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyCommand, snapshotFor } from '../src/lib/demo';
import { seedState, ids } from '../src/lib/seed';
import type { Command, Deal, Listing, Role, State } from '../src/lib/domain';
import { auditRuntimeDatabase } from '../src/lib/database-readiness';

// All SQL runs in an isolated engine. No hosted records or environment files.
const db = new PGlite();
const campus = randomUUID();
let admin: string, otherAdmin: string, student: string, business: string, businessProfile: string;
type Entity = 'listing' | 'deal' | 'ticket';
type Decision = 'approve' | 'remove' | 'resolve';
const reason = 'The current record and supporting details have been reviewed.';
async function member(role: Role = 'student', suspended = false) {
  const id = randomUUID();
  await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [id, 'Moderation member', id + '@example.test']);
  await db.query('UPDATE profiles SET role=$2,verified=true,college_id=$3,suspended=$4 WHERE id=$1', [id, role, campus, suspended]);
  return id;
}
async function asUser<T>(id: string | null, work: () => Promise<T>): Promise<T> {
  await db.exec('BEGIN; SET LOCAL ROLE unicirq_app;');
  try {
    if (id) await db.query("SELECT set_config('app.user_id',$1,true)", [id]);
    const result = await work(); await db.exec('COMMIT'); return result;
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
}
async function command(actor: string | null, payload: object) {
  return asUser(actor, async () => (await db.query<{ result: { id: string } }>('SELECT unicirq_command($1::jsonb) AS result', [JSON.stringify(payload)])).rows[0].result);
}
const decision = (entity: Entity, target_id: string, outcome: Decision, extra: Record<string, unknown> = {}) => ({ type: 'moderate', entity, target_id, decision: outcome, reason, ...extra });
async function listing(status: Listing['status'] = 'pending', owner = student) {
  const id = randomUUID();
  await db.query(`INSERT INTO listings(id,owner_id,college_id,title,description,kind,category,price,unit,condition,location,status)
    VALUES($1,$2,$3,'Review calculator','Working calculator with its original cover.','sale','Electronics',10000,'item','Good','Main library',$4)`, [id, owner, campus, status]);
  return id;
}
async function deal(status: Deal['status'] = 'pending', expired = false) {
  const id = randomUUID();
  await db.query(`INSERT INTO deals(id,business_id,owner_id,college_id,title,description,code,expires_on,status)
    VALUES($1,$2,$3,$4,'Campus discount','A discount for the campus community.','REVIEW',current_date+$5::integer,$6)`, [id, businessProfile, business, campus, expired ? -1 : 1, status]);
  return id;
}
async function ticket(owner = student, type: 'support' | 'managed_sale' = 'support') {
  const id = randomUUID();
  await db.query(`INSERT INTO support_tickets(id,owner_id,college_id,subject,body,type) VALUES($1,$2,$3,'Campus question','Please review this campus support question.',$4)`, [id, owner, campus, type]);
  return id;
}
async function unchangedAfterReject(actor: string | null, payload: object) {
  const before = await db.query('SELECT row_to_json(s) AS state FROM (SELECT (SELECT jsonb_agg(l) FROM listings l) AS listings,(SELECT jsonb_agg(d) FROM deals d) AS deals,(SELECT jsonb_agg(t) FROM support_tickets t) AS tickets,(SELECT jsonb_agg(a) FROM audit_logs a) AS audit,(SELECT jsonb_agg(n) FROM notifications n) AS notifications,(SELECT jsonb_agg(r) FROM action_limits r) AS rate) s');
  await assert.rejects(() => command(actor, payload));
  assert.deepEqual((await db.query('SELECT row_to_json(s) AS state FROM (SELECT (SELECT jsonb_agg(l) FROM listings l) AS listings,(SELECT jsonb_agg(d) FROM deals d) AS deals,(SELECT jsonb_agg(t) FROM support_tickets t) AS tickets,(SELECT jsonb_agg(a) FROM audit_logs a) AS audit,(SELECT jsonb_agg(n) FROM notifications n) AS notifications,(SELECT jsonb_agg(r) FROM action_limits r) AS rate) s')).rows, before.rows);
}
async function audit() {
  await db.exec('SET SESSION AUTHORIZATION moderation_runtime;');
  try { return await auditRuntimeDatabase({ query: (sql, params) => db.query(sql, params) }); }
  finally { await db.exec('SET SESSION AUTHORIZATION postgres;'); }
}
before(async () => {
  for (const file of (await readdir('database/migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) await db.exec(await readFile('database/migrations/' + file, 'utf8'));
  await db.query('INSERT INTO colleges(id,name,short_name,domain,city) VALUES($1,$2,$2,$3,$4)', [campus, 'Moderation test campus', campus + '.example.test', 'Test city']);
  admin = await member('admin'); otherAdmin = await member('admin'); student = await member(); business = await member('business');
  businessProfile = randomUUID();
  await db.query(`INSERT INTO business_profiles(id,owner_id,college_id,name,category,description,location,verified)
    VALUES($1,$2,$3,'Test campus business','Stationery','Stationery for campus members.','North gate',true)`, [businessProfile, business, campus]);
  await db.exec(`REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE ROLE moderation_runtime LOGIN;
    GRANT USAGE ON SCHEMA public TO moderation_runtime;
    GRANT SELECT,INSERT,UPDATE,DELETE ON "user","session",account,verification,"rateLimit" TO moderation_runtime;
    GRANT unicirq_app TO moderation_runtime;`);
});
after(async () => { await db.close(); });

test('SQL denies anonymous, suspended and non-admin moderation with no state or audit side effects', async () => {
  const target = await listing(), offer = await deal(), support = await ticket();
  for (const actor of [null, student, business, await member('admin', true)]) {
    for (const payload of [decision('listing', target, 'approve'), decision('deal', offer, 'approve'), decision('ticket', support, 'resolve')]) await unchangedAfterReject(actor, payload);
  }
});

test('SQL accepts only pending approval and pending/active removal, never reopens inventory or repeats audits', async () => {
  for (const entity of ['listing', 'deal'] as const) {
    const target = entity === 'listing' ? await listing() : await deal();
    assert.equal((await command(admin, decision(entity, target, 'approve', { reason: '  Independent record check complete.  ', actor_id: student }))).id, target);
    const log = (await db.query<{ actor_id: string; reason: string }>('SELECT actor_id,reason FROM audit_logs WHERE target_id=$1', [target])).rows;
    assert.deepEqual(log, [{ actor_id: admin, reason: 'Independent record check complete.' }]);
    await unchangedAfterReject(otherAdmin, decision(entity, target, 'approve'));
    await command(otherAdmin, decision(entity, target, 'remove'));
    await unchangedAfterReject(admin, decision(entity, target, 'approve'));
    await unchangedAfterReject(admin, decision(entity, target, 'remove'));
    const pending = entity === 'listing' ? await listing() : await deal();
    await command(admin, decision(entity, pending, 'remove'));
  }
  const closed = await listing('closed');
  for (const outcome of ['approve', 'remove'] as const) await unchangedAfterReject(admin, decision('listing', closed, outcome));
});

test('SQL rejects expired deal approval, invalid decisions, missing records and invalid trimmed reasons', async () => {
  const expired = await deal('pending', true);
  await unchangedAfterReject(admin, decision('deal', expired, 'approve'));
  await command(admin, decision('deal', expired, 'remove'));
  for (const entity of ['listing', 'deal', 'ticket'] as const) {
    const target = entity === 'listing' ? await listing() : entity === 'deal' ? await deal() : await ticket();
    for (const invalid of [undefined, '', '    ', '1234', 'x'.repeat(501)]) await unchangedAfterReject(admin, decision(entity, target, entity === 'ticket' ? 'resolve' : 'approve', { reason: invalid }));
    await unchangedAfterReject(admin, decision(entity, target, entity === 'ticket' ? 'approve' : 'resolve'));
    await unchangedAfterReject(admin, decision(entity, randomUUID(), entity === 'ticket' ? 'resolve' : 'approve'));
  }
});

test('SQL resolves a ticket once, notifies its current role, and keeps response and audit private', async () => {
  for (const [owner, href] of [[student, '/student/support'], [business, '/business/support'], [otherAdmin, '/admin/support']] as const) {
    const target = await ticket(owner);
    await command(admin, decision('ticket', target, 'resolve', { reason: '  Confirmed the campus pickup arrangements.  ' }));
    assert.deepEqual((await db.query<{ status: string; resolution: string }>('SELECT status,resolution FROM support_tickets WHERE id=$1', [target])).rows, [{ status: 'resolved', resolution: 'Confirmed the campus pickup arrangements.' }]);
    const notification = (await asUser(owner, () => db.query<{ user_id: string; body: string; href: string }>('SELECT user_id,body,href FROM notifications WHERE body=$1', ['Confirmed the campus pickup arrangements.']))).rows;
    assert.ok(notification.some(row => row.user_id === owner && row.href === href));
    await unchangedAfterReject(otherAdmin, decision('ticket', target, 'resolve', { reason: 'Replace this already recorded response.' }));
  }
  const stranger = await member();
  assert.equal((await asUser(stranger, () => db.query('SELECT * FROM support_tickets'))).rows.length, 0);
  assert.equal((await asUser(stranger, () => db.query('SELECT * FROM audit_logs'))).rows.length, 0);
  assert.equal((await asUser(stranger, () => db.query('SELECT * FROM notifications'))).rows.length, 0);
});

test('SQL resolving disputes, reports and managed-sale interest changes only the support record', async () => {
  const target = await listing('active'), buyer = await member();
  const order = await command(buyer, { type: 'create_order', listing_id: target });
  const dispute = await command(buyer, { type: 'create_ticket', kind: 'dispute', order_id: order.id, subject: 'Item condition disagreement', body: 'Please review the difference in the stated condition.' });
  const report = await command(buyer, { type: 'create_ticket', kind: 'report', listing_id: target, subject: 'Listing details need review', body: 'Please check the description of this campus listing.' });
  const managed = await ticket(student, 'managed_sale');
  const before = (await db.query('SELECT row_to_json(o) AS record FROM orders o WHERE id=$1', [order.id])).rows;
  const events = (await db.query('SELECT * FROM order_events WHERE order_id=$1 ORDER BY created_at,id', [order.id])).rows;
  for (const id of [dispute.id, report.id, managed]) await command(admin, decision('ticket', id, 'resolve'));
  assert.deepEqual((await db.query('SELECT row_to_json(o) AS record FROM orders o WHERE id=$1', [order.id])).rows, before);
  assert.deepEqual((await db.query('SELECT * FROM order_events WHERE order_id=$1 ORDER BY created_at,id', [order.id])).rows, events);
  assert.equal((await db.query<{ status: string }>('SELECT status FROM listings WHERE id=$1', [target])).rows[0].status, 'active');
});

test('SQL rolls back the record, notification, and rate counter when audit persistence fails', async () => {
  const actor = await member('admin'), target = await ticket();
  await db.exec(`CREATE FUNCTION fail_moderation_audit_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Test audit failure'; END $$;
    CREATE TRIGGER fail_moderation_audit_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_moderation_audit_test();`);
  try { await unchangedAfterReject(actor, decision('ticket', target, 'resolve')); }
  finally { await db.exec('DROP TRIGGER fail_moderation_audit_test ON audit_logs; DROP FUNCTION fail_moderation_audit_test();'); }
  assert.equal((await db.query('SELECT * FROM action_limits WHERE user_id=$1', [actor])).rows.length, 0);
});

test('SQL preserves the sixty-per-minute command limit for valid moderation decisions', async () => {
  const actor = await member('admin');
  for (let index = 0; index < 60; index++) await command(actor, decision('listing', await listing('active'), 'remove'));
  const remaining = await listing('active');
  await assert.rejects(() => command(actor, decision('listing', remaining, 'remove')), /wait a minute/);
  assert.equal((await db.query<{ count: number }>('SELECT count(*)::int AS count FROM audit_logs WHERE actor_id=$1', [actor])).rows[0].count, 60);
  assert.equal((await db.query<{ status: string }>('SELECT status FROM listings WHERE id=$1', [remaining])).rows[0].status, 'active');
});

test('SQL delegates onboarding, verification evidence guards and photo creation through existing commands', async () => {
  const applicant = await member();
  await db.query('UPDATE profiles SET college_id=null,verified=false WHERE id=$1', [applicant]);
  await asUser(applicant, () => db.query('SELECT app_choose_university($1::jsonb)', [JSON.stringify({ type: 'choose_university', college_id: campus, name: 'New campus member' })]));
  const application = await command(applicant, { type: 'request_verification', college_id: campus, kind: 'campus', detail: 'Please confirm enrollment with the campus office.' });
  await assert.rejects(() => command(admin, { ...decision('listing', application.id, 'approve'), entity: 'verification' }), /evidence/);
  await command(admin, { ...decision('listing', application.id, 'approve'), entity: 'verification', review_method: 'campus_office', evidence_checked: true });
  const bytes = Buffer.alloc(24); bytes.write('RIFF'); bytes.writeUInt32LE(16, 4); bytes.write('WEBP', 8);
  const photo = await asUser(applicant, () => db.query<{ result: { id: string } }>('SELECT app_create_listing_with_photo($1::jsonb,$2::bytea) AS result', [JSON.stringify({ type: 'create_listing', title: 'A campus lamp', description: 'A small working lamp with a power cable.', kind: 'sale', category: 'Room essentials', price: 20000, unit: 'item', condition: 'Good', location: 'Campus library' }), bytes]));
  assert.equal((await asUser(applicant, () => db.query('SELECT * FROM listing_photos WHERE listing_id=$1', [photo.rows[0].result.id]))).rows.length, 1);
});

test('readiness and runtime grants reject either executable superseded command wrapper', async () => {
  assert.equal((await audit()).ok, true);
  for (const name of ['app_command_before_verification_reviews', 'app_command_before_moderation_workspaces']) {
    await assert.rejects(() => asUser(student, () => db.query(`SELECT ${name}($1::jsonb)`, [JSON.stringify(decision('listing', randomUUID(), 'approve'))])), /permission denied/);
    for (const grantee of ['unicirq_app', 'moderation_runtime', 'PUBLIC']) {
      await db.exec(`GRANT EXECUTE ON FUNCTION ${name}(jsonb) TO ${grantee};`);
      try {
        const check = (await audit()).checks.find(item => item.name === 'protected-function-grants');
        assert.equal(check?.ok, false); assert.ok(check.items?.includes(name + '(jsonb)'));
      } finally { await db.exec(`REVOKE ALL ON FUNCTION ${name}(jsonb) FROM ${grantee};`); }
    }
  }
});

function demoDecision(entity: Entity, target_id: string, outcome: Decision, extra: Partial<Extract<Command, { type: 'moderate' }>> = {}): Extract<Command, { type: 'moderate' }> {
  return { type: 'moderate', entity, target_id, decision: outcome, reason, ...extra };
}
const demoAdmin = (state: State) => state.profiles.find(profile => profile.id === ids.admin)!;
function demoReject(state: State, payload: Extract<Command, { type: 'moderate' }>) {
  const before = structuredClone(state);
  assert.throws(() => applyCommand(state, demoAdmin(state), payload)); assert.deepEqual(state, before);
}
test('demo inventory decisions mirror stale, replay, invalid-reason and expiration guards without partial changes', () => {
  const state = seedState();
  for (const entity of ['listing', 'deal'] as const) {
    const item = entity === 'listing' ? state.listings[0] : state.deals[0]; item.status = 'pending';
    applyCommand(state, demoAdmin(state), demoDecision(entity, item.id, 'approve', { reason: '  A reviewed and accepted record.  ' }));
    assert.equal(state.audit[0].reason, 'A reviewed and accepted record.');
    demoReject(state, demoDecision(entity, item.id, 'approve'));
    applyCommand(state, demoAdmin(state), demoDecision(entity, item.id, 'remove'));
    for (const outcome of ['approve', 'remove'] as const) demoReject(state, demoDecision(entity, item.id, outcome));
  }
  const closed = state.listings[1]; closed.status = 'closed';
  for (const outcome of ['approve', 'remove'] as const) demoReject(state, demoDecision('listing', closed.id, outcome));
  const expired = state.deals[0]; expired.status = 'pending'; expired.expires_on = '2000-01-01';
  demoReject(state, demoDecision('deal', expired.id, 'approve'));
  for (const entity of ['listing', 'deal', 'ticket'] as const) {
    const target = entity === 'listing' ? state.listings[2].id : entity === 'deal' ? expired.id : state.tickets[0].id;
    for (const invalid of ['    ', '1234', 'x'.repeat(501)]) demoReject(state, demoDecision(entity, target, entity === 'ticket' ? 'resolve' : 'remove', { reason: invalid }));
  }
  for (const id of [ids.student, ids.business]) assert.throws(() => applyCommand(state, state.profiles.find(profile => profile.id === id)!, demoDecision('listing', closed.id, 'remove')), /access/);
});

test('demo ticket resolution is single-use, role-aware and does not settle disputed orders or expose responses', () => {
  const state = seedState(), actor = demoAdmin(state);
  const order = state.orders[0]; order.status = 'disputed';
  const orderBefore = structuredClone(order), eventsBefore = structuredClone(state.orderEvents);
  const campusListing = state.listings.find(item => item.id === order.listing_id)!;
  const listingBefore = structuredClone(campusListing);
  for (const [owner, href] of [[ids.student, '/student/support'], [ids.business, '/business/support'], [ids.admin, '/admin/support']] as const) {
    const item = { ...state.tickets[0], id: randomUUID(), owner_id: owner, order_id: order.id, type: 'dispute' as const, status: 'open' as const, resolution: '' };
    state.tickets.push(item);
    applyCommand(state, actor, demoDecision('ticket', item.id, 'resolve', { reason: '  The support response has been recorded.  ' }));
    assert.equal(item.resolution, 'The support response has been recorded.');
    assert.equal(state.notifications[0].href, href); assert.equal(state.notifications[0].user_id, owner);
    demoReject(state, demoDecision('ticket', item.id, 'resolve'));
  }
  assert.deepEqual(order, orderBefore); assert.deepEqual(state.orderEvents, eventsBefore); assert.deepEqual(campusListing, listingBefore);
  const stranger = state.profiles.find(profile => profile.id === ids.tutor)!;
  assert.equal(snapshotFor(state, stranger).tickets.length, 0); assert.equal(snapshotFor(state, stranger).audit.length, 0);
  assert.equal(snapshotFor(state, stranger).notifications.length, 0);
});
