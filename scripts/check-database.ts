import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { auditMigrationLedger, auditRuntimeDatabase, inspectDatabaseTransport, type DatabaseReadinessReport, type MigrationChecksum } from '../src/lib/database-readiness';

function show(report: DatabaseReadinessReport) {
  for (const check of report.checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.message}${check.items?.length ? ' [' + check.items.join(', ') + ']' : ''}`);
  if (!report.ok) process.exitCode = 1;
}

async function connectAndCheck(connectionString: string, purpose: 'runtime' | 'migrations', expected: MigrationChecksum[] = []) {
  const configured = inspectDatabaseTransport(connectionString);
  if (!configured.ok) { show({ ok: false, checks: [configured] }); return; }
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 10000, application_name: 'unicirq-readiness-check' });
  try {
    await client.connect();
    // pg_stat_ssl exposes transport state only for this connection; no user data.
    const transport = await client.query<{ ssl: boolean }>('SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
    const encrypted = transport.rows[0]?.ssl ?? false;
    const actual = inspectDatabaseTransport(connectionString, encrypted);
    show({ ok: actual.ok, checks: [actual] });
    if (!actual.ok) return;
    show(purpose === 'runtime' ? await auditRuntimeDatabase(client) : await auditMigrationLedger(client, expected));
  } catch { console.error(`FAIL ${purpose}-connection: Database readiness could not be inspected. Check this connection and its permissions.`); process.exitCode = 1; }
  finally { try { await client.end(); } catch { /* Never print connection error details or credentials. */ } }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => arg !== '--require-migrations')) { console.error('Usage: db:check [--require-migrations]'); process.exitCode = 1; return; }
  const requireMigrations = args[0] === '--require-migrations';
  const runtime = process.env.DATABASE_URL?.trim();
  const operator = process.env.MIGRATION_DATABASE_URL?.trim();
  if (requireMigrations && !operator) { console.error('FAIL migration-checksums: --require-migrations needs MIGRATION_DATABASE_URL in the local private environment.'); process.exitCode = 1; return; }
  if (!runtime) { console.error('FAIL runtime-connection: Set DATABASE_URL to the restricted runtime connection.'); process.exitCode = 1; return; }
  await connectAndCheck(runtime, 'runtime');
  if (!operator) { console.log('NOT CHECKED migration-checksums: Set MIGRATION_DATABASE_URL locally to verify applied migration metadata.'); return; }
  const directory = new URL('../database/migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const expected = await Promise.all(files.map(async name => ({ name, checksum: createHash('sha256').update(await readFile(new URL(name, directory))).digest('hex') })));
  await connectAndCheck(operator, 'migrations', expected);
}

main().catch(() => { console.error('FAIL database-readiness: The readiness check could not complete.'); process.exitCode = 1; });
