import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { auditMigrationLedger, auditRuntimeDatabase, inspectDatabaseTransport, type DatabaseQueryable, type DatabaseReadinessReport, type MigrationChecksum } from '../src/lib/database-readiness';

const db = new PGlite();
const queries: string[] = [];
const queryable: DatabaseQueryable = { async query(sql, params) { queries.push(sql); return db.query<Record<string, unknown>>(sql, params); } };
let expected: MigrationChecksum[];
async function runtimeAudit() {
  await db.exec('SET SESSION AUTHORIZATION audit_runtime;');
  try { return await auditRuntimeDatabase(queryable); }
  finally { await db.exec('SET SESSION AUTHORIZATION postgres;'); }
}
function failure(report: DatabaseReadinessReport, name: string) { const item = report.checks.find(check => check.name === name); assert.ok(item, 'Expected check: ' + name); assert.equal(item.ok, false); return item; }
before(async () => {
  const files = (await readdir('database/migrations')).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  expected = [];
  for (const name of files) { const source = await readFile('database/migrations/' + name, 'utf8'); await db.exec(source); expected.push({ name, checksum: createHash('sha256').update(source).digest('hex') }); }
  await db.exec(`CREATE TABLE unicirq_migrations(name text PRIMARY KEY,checksum text NOT NULL);
    REVOKE ALL ON unicirq_migrations FROM PUBLIC;
    REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    CREATE ROLE audit_runtime LOGIN;
    GRANT USAGE ON SCHEMA public TO audit_runtime;
    GRANT SELECT,INSERT,UPDATE,DELETE ON "user","session",account,verification,"rateLimit" TO audit_runtime;
    GRANT unicirq_app TO audit_runtime;`);
  for (const file of expected) await db.query('INSERT INTO unicirq_migrations(name,checksum) VALUES($1,$2)', [file.name, file.checksum]);
});
after(async () => { await db.close(); });

test('database audit accepts the documented restricted login without reading personal rows', async () => {
  queries.length = 0;
  const report = await runtimeAudit();
  assert.equal(report.ok, true, JSON.stringify(report.checks));
  assert.equal(report.checks.length, 11);
  assert.ok(queries.includes('BEGIN READ ONLY')); assert.equal(queries.at(-1), 'ROLLBACK');
  assert.ok(!queries.some(query => /\bFROM\s+(?:public\.)?["']?(?:user|session|profiles|orders|messages)\b/i.test(query)));
  assert.equal((await db.query<{ transaction_read_only: string }>('SHOW transaction_read_only')).rows[0].transaction_read_only, 'off');
});

test('database audit rejects the migration owner login', async () => {
  const report = await auditRuntimeDatabase(queryable);
  assert.equal(report.ok, false); failure(report, 'runtime-login'); failure(report, 'table-ownership'); failure(report, 'migration-owner-separation');
});

test('database audit rejects inherited app writes and column privilege escalation', async () => {
  await db.exec('CREATE ROLE audit_writer NOLOGIN; GRANT audit_writer TO audit_runtime; GRANT UPDATE(role) ON profiles TO audit_writer;');
  try { assert.ok(failure(await runtimeAudit(), 'application-write-grants').items?.includes('profiles')); }
  finally { await db.exec('REVOKE audit_writer FROM audit_runtime; DROP OWNED BY audit_writer; DROP ROLE audit_writer;'); }
});

test('database audit rejects non-inherited but assumable owner and bypass roles', async () => {
  await db.exec('CREATE ROLE audit_escalation NOLOGIN NOINHERIT BYPASSRLS; GRANT audit_escalation TO audit_runtime;');
  try { failure(await runtimeAudit(), 'runtime-role-memberships'); }
  finally { await db.exec('REVOKE audit_escalation FROM audit_runtime; DROP ROLE audit_escalation;'); }
});

test('database audit rejects schema creation and migration ledger access', async () => {
  await db.exec('GRANT CREATE ON SCHEMA public TO audit_runtime; GRANT SELECT ON unicirq_migrations TO audit_runtime;');
  try { const report = await runtimeAudit(); failure(report, 'schema-and-database-creation'); failure(report, 'migration-owner-separation'); }
  finally { await db.exec('REVOKE CREATE ON SCHEMA public FROM audit_runtime; REVOKE SELECT ON unicirq_migrations FROM audit_runtime;'); }
});

test('database audit checks auth grants, RLS, command execute, and role assumption independently', async () => {
  await db.exec('REVOKE DELETE ON verification FROM audit_runtime; ALTER TABLE listings DISABLE ROW LEVEL SECURITY; REVOKE EXECUTE ON FUNCTION unicirq_command(jsonb) FROM unicirq_app;');
  try { const report = await runtimeAudit(); assert.ok(failure(report, 'auth-table-grants').items?.includes('verification')); assert.ok(failure(report, 'application-row-security').items?.includes('listings')); assert.ok(failure(report, 'protected-function-grants').items?.includes('unicirq_command(jsonb)')); }
  finally { await db.exec('GRANT DELETE ON verification TO audit_runtime; ALTER TABLE listings ENABLE ROW LEVEL SECURITY; GRANT EXECUTE ON FUNCTION unicirq_command(jsonb) TO unicirq_app;'); }
  await db.exec('REVOKE unicirq_app FROM audit_runtime;');
  try { failure(await runtimeAudit(), 'runtime-audit'); }
  finally { await db.exec('GRANT unicirq_app TO audit_runtime;'); }
});

test('database audit rejects authentication grant options and function ownership', async () => {
  await db.exec('GRANT SELECT ON "user" TO audit_runtime WITH GRANT OPTION; ALTER FUNCTION app_campus() OWNER TO audit_runtime;');
  try { const report = await runtimeAudit(); assert.ok(failure(report, 'auth-table-grants').items?.includes('user')); assert.ok(failure(report, 'protected-function-grants').items?.includes('app_campus()')); }
  finally { await db.exec('REVOKE GRANT OPTION FOR SELECT ON "user" FROM audit_runtime; ALTER FUNCTION app_campus() OWNER TO postgres;'); }
});

test('migration audit checks recorded checksums without mutations and does not expose checksums', async () => {
  queries.length = 0;
  const good = await auditMigrationLedger(queryable, expected); assert.equal(good.ok, true); assert.ok(queries.includes('BEGIN READ ONLY')); assert.equal(queries.at(-1), 'ROLLBACK');
  await db.query('UPDATE unicirq_migrations SET checksum=$1 WHERE name=$2', ['invalid-stored-checksum', expected[0].name]);
  try { const bad = await auditMigrationLedger(queryable, expected); assert.ok(failure(bad, 'migration-checksums').items?.includes(expected[0].name)); assert.ok(!JSON.stringify(bad).includes('invalid-stored-checksum')); }
  finally { await db.query('UPDATE unicirq_migrations SET checksum=$1 WHERE name=$2', [expected[0].checksum, expected[0].name]); }
});

test('database audit errors are sanitized and rollback is always attempted', async () => {
  const called: string[] = [];
  const broken: DatabaseQueryable = { async query(sql) { called.push(sql); if (sql !== 'ROLLBACK') throw new Error('secret://username:password@database/private-user-data'); return { rows: [] }; } };
  const report = await auditRuntimeDatabase(broken); assert.equal(report.ok, false); assert.equal(called.at(-1), 'ROLLBACK'); assert.ok(!JSON.stringify(report).includes('password'));
  const migration = await auditMigrationLedger(broken, expected); assert.equal(migration.ok, false); assert.ok(!JSON.stringify(migration).includes('password'));
});

test('database transport requires verified remote TLS without printing credentials', () => {
  assert.equal(inspectDatabaseTransport('postgresql://runtime:secret@localhost:5432/test').ok, true);
  assert.equal(inspectDatabaseTransport('postgresql://runtime:secret@db.example.test/test?sslmode=verify-full', true).ok, true);
  for (const connection of ['postgresql://runtime:secret@db.example.test/test', 'postgresql://runtime:secret@db.example.test/test?sslmode=require', 'postgresql://runtime:secret@db.example.test/test?sslmode=verify-full&ssl=false', 'not-a-url']) assert.equal(inspectDatabaseTransport(connection).ok, false);
  for (const params of ['host=db.example.test', 'hostaddr=203.0.113.5', 'sslmode=verify-full&sslmode=disable', 'sslrejectunauthorized=false', 'ssl=0']) assert.equal(inspectDatabaseTransport('postgresql://runtime:secret@localhost/test?' + params).ok, false);
  const report = inspectDatabaseTransport('postgresql://runtime:secret@db.example.test/test?sslmode=verify-full', false); assert.equal(report.ok, false); assert.ok(!JSON.stringify(report).includes('secret'));
});

test('database CLI refuses a full-launch check without operator credentials and rejects unknown arguments', () => {
  const env = { ...process.env, DATABASE_URL: 'postgresql://runtime:secret@localhost/test', MIGRATION_DATABASE_URL: '' };
  const missing = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-database.ts', '--require-migrations'], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /MIGRATION_DATABASE_URL/); assert.ok(!missing.stderr.includes('secret'));
  const unexpected = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-database.ts', '--unknown'], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(unexpected.status, 1); assert.match(unexpected.stderr, /Usage: db:check/);
});
