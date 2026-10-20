import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// All identities and mutations below live in a disposable PostgreSQL engine.
const db = new PGlite();
const campus = randomUUID(), otherCampus = randomUUID();
let beforeCampus: string;
type Profile = {
  id: string; college_id: string | null; role: string; verified: boolean;
  suspended: boolean; campus_verification_source: string | null;
  campus_email_verified_at: Date | null;
};

async function member(options: { email?: string; verified?: boolean; proof?: string | null } = {}) {
  const id = randomUUID(), email = options.email ?? `${id}@dypiu.ac.in`;
  await db.query('INSERT INTO "user"(id,name,email,"emailVerified","campusEmailProof") VALUES($1,$2,$3,$4,$5)',
    [id, 'Campus email member', email, options.verified ?? true, options.proof ?? null]);
  return id;
}

async function profile(id: string) {
  return (await db.query<Profile>(`SELECT id,college_id,role,verified,suspended,
    campus_verification_source,campus_email_verified_at FROM profiles WHERE id=$1`, [id])).rows[0];
}

async function proof(id: string, value?: string | null) {
  await db.query('UPDATE "user" SET "campusEmailProof"=coalesce($2,lower(btrim(email))) WHERE id=$1', [id, value ?? null]);
}

async function asMember<T>(id: string | null, work: () => Promise<T>): Promise<T> {
  await db.exec('BEGIN; SET LOCAL ROLE unicirq_app;');
  try {
    if (id) await db.query("SELECT set_config('app.user_id',$1,true)", [id]);
    const result = await work();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

async function sideEffects(id: string) {
  return {
    notifications: (await db.query<{ title: string; body: string; href: string }>('SELECT title,body,href FROM notifications WHERE user_id=$1', [id])).rows,
    audits: (await db.query<{ actor_id: string; action: string; target_id: string; reason: string }>('SELECT actor_id,action,target_id,reason FROM audit_logs WHERE target_id=$1', [id])).rows,
  };
}

async function application(id: string, values: { kind?: string; status?: string; college?: string } = {}) {
  const request = randomUUID();
  await db.query(`INSERT INTO verification_requests(id,user_id,college_id,kind,status,detail,reason)
    VALUES($1,$2,$3,$4,$5,'Campus affiliation needs independent review.','Original application decision.')`,
  [request, id, values.college ?? campus, values.kind ?? 'campus', values.status ?? 'pending']);
  return request;
}

before(async () => {
  for (const file of (await readdir('database/migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
    await db.exec(await readFile('database/migrations/' + file, 'utf8'));
  }
  // A proof cannot invent a campus, and provisioning a campus does not backfill users.
  beforeCampus = await member({ email: 'before-campus@dypiu.ac.in', proof: 'before-campus@dypiu.ac.in' });
  await db.query('INSERT INTO colleges(id,name,short_name,domain,city) VALUES($1,$2,$3,$4,$5)',
    [campus, 'D. Y. Patil International University', 'DYPIU Akurdi', 'DYPIU.AC.IN', 'Pune']);
  await db.query('INSERT INTO colleges(id,name,short_name,domain,city) VALUES($1,$2,$3,$4,$5)',
    [otherCampus, 'Another university', 'Other campus', 'other.example.test', 'Test city']);
});

after(async () => { await db.close(); });

test('university proof requires a provisioned campus and never backfills existing users', async () => {
  assert.equal((await profile(beforeCampus)).verified, false);
  assert.equal((await profile(beforeCampus)).college_id, null);
  assert.deepEqual(await sideEffects(beforeCampus), { notifications: [], audits: [] });
});

test('fresh trusted proof creates the student profile first and selects DYPIU on initial signup', async () => {
  const email = 'New.Student@DYPIU.AC.IN', id = await member({ email, proof: email.toLowerCase() });
  const row = await profile(id);
  assert.equal(row.role, 'student');
  assert.equal(row.verified, true);
  assert.equal(row.college_id, campus);
  assert.equal(row.campus_verification_source, 'university_email');
  assert.ok(row.campus_email_verified_at);
  const events = await sideEffects(id);
  assert.equal(events.notifications.length, 1);
  assert.equal(events.notifications[0].title, 'DYPIU email verified');
  assert.equal(events.notifications[0].href, '/student/profile#verification');
  assert.match(String(events.notifications[0].body), /not current student enrollment/);
  assert.equal(events.audits.length, 1);
  assert.deepEqual(events.audits.map(event => [event.actor_id, event.action, event.target_id]), [[id, 'university_email.verified', id]]);
  assert.equal(JSON.stringify(events).toLowerCase().includes(email.toLowerCase()), false);
});

test('verified suffix alone, absent proof, mismatched proof, and unverified email never grant campus access', async () => {
  const noProof = await member(), wrongProof = await member(), unverified = await member({ verified: false });
  await proof(wrongProof, 'a-different-owner@dypiu.ac.in');
  await proof(unverified);
  for (const id of [noProof, wrongProof, unverified]) {
    const row = await profile(id);
    assert.equal(row.verified, false);
    assert.equal(row.college_id, null);
    assert.equal(row.campus_verification_source, null);
    assert.equal(row.campus_email_verified_at, null);
    assert.deepEqual(await sideEffects(id), { notifications: [], audits: [] });
  }
  // A later successful email ownership check can then complete the grant.
  await db.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [unverified]);
  assert.equal((await profile(unverified)).verified, true);
});

test('lookalikes, subdomains, embedded whitespace and malformed addresses do not pass SQL mapping', async () => {
  for (const email of [
    'member@dypiu.ac.in.evil.test', 'member@sub.dypiu.ac.in', 'member@dypiu-ac.in',
    'member@@dypiu.ac.in', '@dypiu.ac.in', 'member name@dypiu.ac.in',
    ' member@dypiu.ac.in', 'member@dypiu.ac.in ', 'member\n@dypiu.ac.in', 'member@gmail.com',
  ]) {
    const id = await member({ email, proof: email.toLowerCase().trim() });
    assert.equal((await profile(id)).verified, false, email);
    assert.equal((await profile(id)).college_id, null, email);
    assert.deepEqual(await sideEffects(id), { notifications: [], audits: [] });
  }
});

test('successful later proof resolves matching pending review without inventing an admin reviewer', async () => {
  const id = await member();
  await db.query('UPDATE profiles SET college_id=$2 WHERE id=$1', [id, campus]);
  const request = await application(id), started = Date.now();
  await proof(id);
  const row = (await db.query<{ status: string; reviewed_by: string | null; reviewed_at: Date; review_method: string; reason: string }>(
    'SELECT status,reviewed_by,reviewed_at,review_method,reason FROM verification_requests WHERE id=$1', [request])).rows[0];
  assert.equal(row.status, 'approved');
  assert.equal(row.reviewed_by, null);
  assert.equal(row.review_method, 'campus_email');
  assert.ok(new Date(row.reviewed_at).getTime() >= started - 1000);
  assert.match(row.reason, /does not confirm current student enrollment/);
  assert.equal((await profile(id)).college_id, campus);
  assert.equal((await profile(id)).verified, true);
});

test('repeat auth updates are idempotent and cannot silently carry proof to another email', async () => {
  const id = await member();
  await proof(id);
  const original = await profile(id), originalEvents = await sideEffects(id);
  await proof(id);
  await db.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [id]);
  await db.query('SELECT app_apply_university_email_verification($1)', [id]);
  assert.deepEqual(await profile(id), original);
  assert.deepEqual(await sideEffects(id), originalEvents);

  const untouched = await member({ email: 'previous-owner@dypiu.ac.in', verified: false, proof: 'previous-owner@dypiu.ac.in' });
  await db.query('UPDATE "user" SET email=$2,"emailVerified"=true WHERE id=$1', [untouched, 'new-owner@dypiu.ac.in']);
  assert.equal((await profile(untouched)).verified, false);
  assert.deepEqual(await sideEffects(untouched), { notifications: [], audits: [] });
});

test('auto verification preserves admin and business roles, suspension, other campuses and manual verification', async () => {
  for (const values of [
    { role: 'admin', suspended: false, campus: null, verified: false },
    { role: 'business', suspended: false, campus, verified: false },
    { role: 'student', suspended: true, campus, verified: false },
    { role: 'student', suspended: false, campus: otherCampus, verified: false },
    { role: 'student', suspended: false, campus, verified: true },
  ]) {
    const id = await member();
    await db.query('UPDATE profiles SET role=$2,suspended=$3,college_id=$4,verified=$5 WHERE id=$1',
      [id, values.role, values.suspended, values.campus, values.verified]);
    const original = await profile(id);
    await proof(id);
    assert.deepEqual(await profile(id), original);
    assert.deepEqual(await sideEffects(id), { notifications: [], audits: [] });
  }
});

test('rejected campus decisions block automatic bypass while business applications remain untouched', async () => {
  const rejected = await member();
  await db.query('UPDATE profiles SET college_id=$2 WHERE id=$1', [rejected, campus]);
  const declined = await application(rejected, { status: 'rejected' });
  const original = (await db.query('SELECT * FROM verification_requests WHERE id=$1', [declined])).rows;
  await proof(rejected);
  assert.equal((await profile(rejected)).verified, false);
  assert.deepEqual((await db.query('SELECT * FROM verification_requests WHERE id=$1', [declined])).rows, original);
  assert.deepEqual(await sideEffects(rejected), { notifications: [], audits: [] });

  const businessApplicant = await member();
  await db.query('UPDATE profiles SET college_id=$2 WHERE id=$1', [businessApplicant, campus]);
  const businessRequest = await application(businessApplicant, { kind: 'business' });
  const pending = (await db.query('SELECT * FROM verification_requests WHERE id=$1', [businessRequest])).rows;
  await proof(businessApplicant);
  assert.equal((await profile(businessApplicant)).verified, true);
  assert.equal((await profile(businessApplicant)).role, 'student');
  assert.deepEqual((await db.query('SELECT * FROM verification_requests WHERE id=$1', [businessRequest])).rows, pending);
  assert.equal((await db.query('SELECT * FROM business_profiles WHERE owner_id=$1', [businessApplicant])).rows.length, 0);
});

test('obsolete other-campus applications and all approved historical records remain unchanged', async () => {
  const id = await member();
  await db.query('UPDATE profiles SET college_id=$2 WHERE id=$1', [id, otherCampus]);
  const stale = await application(id, { college: otherCampus });
  await db.query('UPDATE profiles SET college_id=NULL WHERE id=$1', [id]);
  const original = (await db.query('SELECT * FROM verification_requests WHERE id=$1', [stale])).rows;
  await proof(id);
  assert.equal((await profile(id)).verified, false);
  assert.deepEqual((await db.query('SELECT * FROM verification_requests WHERE id=$1', [stale])).rows, original);

  const historical = await member();
  await db.query('UPDATE profiles SET college_id=$2,verified=true WHERE id=$1', [historical, campus]);
  const approved = await application(historical, { status: 'approved' });
  const history = (await db.query('SELECT * FROM verification_requests WHERE id=$1', [approved])).rows;
  await proof(historical);
  assert.deepEqual((await db.query('SELECT * FROM verification_requests WHERE id=$1', [approved])).rows, history);
  assert.equal((await profile(historical)).campus_verification_source, null);
});

test('application role cannot supply private proof, directly grant verification, or execute owner-only helpers', async () => {
  const id = await member();
  for (const actor of [id, null]) {
    await assert.rejects(() => asMember(actor, () => db.query('UPDATE "user" SET "campusEmailProof"=email,"emailVerified"=true WHERE id=$1', [id])), /permission denied/);
    await assert.rejects(() => asMember(actor, () => db.query("UPDATE profiles SET verified=true,campus_verification_source='university_email',college_id=$2 WHERE id=$1", [id, campus])), /permission denied/);
    await assert.rejects(() => asMember(actor, () => db.query('SELECT app_apply_university_email_verification($1)', [id])), /permission denied/);
    for (const helper of ['create_student_profile', 'app_refresh_university_email_verification']) {
      await assert.rejects(() => asMember(actor, () => db.query('SELECT ' + helper + '()')), /permission denied/);
    }
  }
  await asMember(id, () => db.query('SELECT unicirq_command($1::jsonb)', [JSON.stringify({
    type: 'update_profile', name: 'Claimed member', bio: '', course: '', year: '',
    campusEmailProof: `${id}@dypiu.ac.in`, verified: true,
    campus_verification_source: 'university_email', college_id: campus, role: 'admin',
  })]));
  assert.equal((await profile(id)).verified, false);
  assert.equal((await profile(id)).role, 'student');
  assert.equal((await profile(id)).college_id, null);
  assert.equal((await db.query<{ proof: string | null }>('SELECT "campusEmailProof" AS proof FROM "user" WHERE id=$1', [id])).rows[0].proof, null);
});

test('owner-only helpers have no PUBLIC or application grants and pin their security-definer search path', async () => {
  for (const signature of ['app_apply_university_email_verification(uuid)', 'create_student_profile()', 'app_refresh_university_email_verification()']) {
    const row = (await db.query<{ app: boolean; public_execute: boolean; definer: boolean; settings: string[] }>(`SELECT
      has_function_privilege('unicirq_app',p.oid,'EXECUTE') AS app,
      EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) grant_record
        WHERE grant_record.grantee=0 AND grant_record.privilege_type='EXECUTE') AS public_execute,
      p.prosecdef AS definer,p.proconfig AS settings FROM pg_proc p WHERE p.oid=$1::regprocedure`, [signature])).rows[0];
    assert.equal(row.app, false, signature);
    assert.equal(row.public_execute, false, signature);
    assert.equal(row.definer, true, signature);
    assert.ok(row.settings.some(value => value.replace(/\s/g, '') === 'search_path=public,pg_temp'), signature);
  }
});
