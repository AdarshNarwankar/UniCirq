import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyCommand } from '../src/lib/demo';
import { commandSchema, type Notification, type Role } from '../src/lib/domain';
import { ids, seedState } from '../src/lib/seed';

// Every SQL test uses a disposable local engine, never hosted records or secrets.
const db = new PGlite();
const campus = randomUUID();

async function member(role: Role = 'student', verified = true, suspended = false) {
  const id = randomUUID();
  await db.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [id, 'Notification member', id + '@example.test']);
  await db.query('UPDATE profiles SET role=$2,verified=$3,suspended=$4,college_id=$5 WHERE id=$1', [id, role, verified, suspended, verified ? campus : null]);
  return id;
}

async function notification(owner: string, read = false) {
  const id = randomUUID();
  await db.query('INSERT INTO notifications(id,user_id,title,body,href,read) VALUES($1,$2,$3,$4,$5,$6)', [id, owner, 'Campus update', 'Your campus exchange has an update.', '/student/activity', read]);
  return id;
}

async function asUser<T>(actor: string | null, work: () => Promise<T>): Promise<T> {
  await db.exec('BEGIN; SET LOCAL ROLE unicirq_app;');
  try {
    if (actor) await db.query("SELECT set_config('app.user_id',$1,true)", [actor]);
    const result = await work();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function command(actor: string | null, payload: object) {
  return asUser(actor, async () => (await db.query<{ result: { id: string } }>('SELECT unicirq_command($1::jsonb) AS result', [JSON.stringify(payload)])).rows[0].result);
}

async function readState(...notificationIds: string[]) {
  return (await db.query<{ id: string; user_id: string; read: boolean }>('SELECT id,user_id,read FROM notifications WHERE id=ANY($1::uuid[]) ORDER BY id', [notificationIds])).rows;
}

function demoNotification(owner: string): Notification {
  return { id: randomUUID(), user_id: owner, title: 'Campus update', body: 'Your campus exchange has an update.', href: '/student/activity', read: false, created_at: new Date().toISOString() };
}

before(async () => {
  for (const file of (await readdir('database/migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
    await db.exec(await readFile('database/migrations/' + file, 'utf8'));
  }
  await db.query('INSERT INTO colleges(id,name,short_name,domain,city) VALUES($1,$2,$2,$3,$4)', [campus, 'Notification test campus', campus + '.example.test', 'Test city']);
});

after(async () => { await db.close(); });

test('notification command accepts an optional UUID while rejecting invalid single-read IDs', () => {
  assert.deepEqual(commandSchema.parse({ type: 'read_notifications' }), { type: 'read_notifications' });
  const notification_id = randomUUID();
  assert.deepEqual(commandSchema.parse({ type: 'read_notifications', notification_id }), { type: 'read_notifications', notification_id });
  for (const invalid of [null, '', 'not-a-uuid', 42]) {
    assert.equal(commandSchema.safeParse({ type: 'read_notifications', notification_id: invalid }).success, false);
  }
});

test('demo opening one notification is idempotent and preserves other unread notifications', () => {
  const state = seedState();
  const actor = state.profiles.find(profile => profile.id === ids.student)!;
  const selected = demoNotification(actor.id), other = demoNotification(actor.id), stranger = demoNotification(ids.business);
  state.notifications = [selected, other, stranger];
  for (let index = 0; index < 2; index++) {
    assert.equal(applyCommand(state, actor, { type: 'read_notifications', notification_id: selected.id }).id, selected.id);
    assert.deepEqual(state.notifications.map(item => item.read), [true, false, false]);
  }
  applyCommand(state, actor, { type: 'read_notifications' });
  assert.deepEqual(state.notifications.map(item => item.read), [true, true, false]);
});

test('demo notification ownership applies to admins and unverified members without role escalation', () => {
  for (const id of [ids.student, ids.business, ids.admin, ids.unverified]) {
    const state = seedState();
    const actor = state.profiles.find(profile => profile.id === id)!;
    const role = actor.role, verified = actor.verified;
    const own = demoNotification(actor.id), stranger = demoNotification(randomUUID());
    state.notifications = [own, stranger];
    applyCommand(state, actor, { type: 'read_notifications', notification_id: own.id });
    assert.throws(() => applyCommand(state, actor, { type: 'read_notifications', notification_id: stranger.id }), /unavailable/);
    assert.throws(() => applyCommand(state, actor, { type: 'read_notifications', notification_id: randomUUID() }), /unavailable/);
    assert.deepEqual(state.notifications.map(item => item.read), [true, false]);
    assert.equal(actor.role, role);
    assert.equal(actor.verified, verified);
    actor.suspended = true;
    assert.throws(() => applyCommand(state, actor, { type: 'read_notifications', notification_id: own.id }), /suspended/);
  }
});

test('SQL single-read works for each active role and unverified members without marking others', async () => {
  for (const [role, verified] of [['student', true], ['business', true], ['admin', true], ['student', false]] as const) {
    const actor = await member(role, verified), stranger = await member();
    const selected = await notification(actor), other = await notification(actor), foreign = await notification(stranger);
    const profile = (await db.query('SELECT * FROM profiles WHERE id=$1', [actor])).rows;
    const payload = { type: 'read_notifications', notification_id: selected, user_id: stranger, role: 'admin' };
    for (let index = 0; index < 2; index++) assert.equal((await command(actor, payload)).id, selected);
    const values = await readState(selected, other, foreign);
    assert.equal(values.find(item => item.id === selected)?.read, true);
    assert.equal(values.find(item => item.id === other)?.read, false);
    assert.equal(values.find(item => item.id === foreign)?.read, false);
    assert.deepEqual((await db.query('SELECT * FROM profiles WHERE id=$1', [actor])).rows, profile);
    assert.equal((await asUser(actor, () => db.query('SELECT * FROM notifications WHERE id=$1', [foreign]))).rows.length, 0);
  }
});

test('SQL denies cross-owner, missing, anonymous and suspended notification reads atomically', async () => {
  const owner = await member(), other = await member(), admin = await member('admin'), suspended = await member('student', true, true);
  const selected = await notification(owner), pending = await notification(other), inactive = await notification(suspended);
  for (const [actor, target] of [[other, selected], [admin, selected], [owner, randomUUID()], [null, selected], [suspended, inactive]] as const) {
    const before = await readState(selected, pending, inactive);
    const rateBefore = (await db.query('SELECT * FROM action_limits ORDER BY user_id')).rows;
    await assert.rejects(() => command(actor, { type: 'read_notifications', notification_id: target }), /unavailable|active account/);
    assert.deepEqual(await readState(selected, pending, inactive), before);
    assert.deepEqual((await db.query('SELECT * FROM action_limits ORDER BY user_id')).rows, rateBefore);
  }
});

test('SQL invalid single-read IDs never fall back to marking all notifications', async () => {
  const actor = await member(), first = await notification(actor), second = await notification(actor);
  for (const notification_id of [null, '', 'not-a-uuid', 42, {}]) {
    await assert.rejects(() => command(actor, { type: 'read_notifications', notification_id }));
    assert.ok((await readState(first, second)).every(item => !item.read));
  }
});

test('SQL legacy mark-all remains owner scoped and available to every active role', async () => {
  for (const [role, verified] of [['student', true], ['business', true], ['admin', true], ['student', false]] as const) {
    const actor = await member(role, verified), stranger = await member();
    const first = await notification(actor), second = await notification(actor), foreign = await notification(stranger);
    await command(actor, { type: 'read_notifications', user_id: stranger });
    const values = await readState(first, second, foreign);
    assert.equal(values.find(item => item.id === first)?.read, true);
    assert.equal(values.find(item => item.id === second)?.read, true);
    assert.equal(values.find(item => item.id === foreign)?.read, false);
  }
});

test('SQL notification reads retain the existing shared sixty-command rate limit', async () => {
  const actor = await member(), selected = await notification(actor), pending = await notification(actor);
  for (let index = 0; index < 60; index++) await command(actor, { type: 'read_notifications', notification_id: selected });
  await assert.rejects(() => command(actor, { type: 'read_notifications', notification_id: pending }), /wait a minute/);
  await assert.rejects(() => command(actor, { type: 'read_notifications' }), /wait a minute/);
  assert.equal((await readState(pending))[0].read, false);
  assert.equal((await db.query<{ request_count: number }>('SELECT request_count FROM action_limits WHERE user_id=$1', [actor])).rows[0].request_count, 60);
});

test('SQL runtime cannot bypass notification ownership or invoke the superseded command', async () => {
  const actor = await member(), selected = await notification(actor);
  await assert.rejects(() => asUser(actor, () => db.query('UPDATE notifications SET read=true WHERE id=$1', [selected])), /permission denied/);
  await assert.rejects(() => asUser(actor, () => db.query('SELECT app_command_before_notification_reads($1::jsonb)', [JSON.stringify({ type: 'read_notifications' })])), /permission denied/);
  const grants = (await db.query<{ current_execute: boolean; previous_execute: boolean; public_execute: boolean; definer: boolean; settings: string[] }>(`SELECT
    has_function_privilege('unicirq_app','unicirq_command(jsonb)','EXECUTE') AS current_execute,
    has_function_privilege('unicirq_app','app_command_before_notification_reads(jsonb)','EXECUTE') AS previous_execute,
    EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) privilege WHERE privilege.grantee=0 AND privilege.privilege_type='EXECUTE') AS public_execute,
    p.prosecdef AS definer,p.proconfig AS settings
    FROM pg_proc p WHERE p.oid='unicirq_command(jsonb)'::regprocedure`)).rows[0];
  assert.equal(grants.current_execute, true);
  assert.equal(grants.previous_execute, false);
  assert.equal(grants.public_execute, false);
  assert.equal(grants.definer, true);
  assert.ok(grants.settings.some(value => value.replace(/\s/g, '') === 'search_path=public,pg_temp'));
  assert.equal((await readState(selected))[0].read, false);
});
