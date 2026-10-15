import { isLoopback, postgresUrlIssue } from './environment';

// Catalog-only readiness checks. Call with a dedicated idle connection, not a pool.
export interface DatabaseQueryable {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export interface ReadinessCheck { name: string; ok: boolean; message: string; items?: string[] }
export interface DatabaseReadinessReport { ok: boolean; checks: ReadinessCheck[] }
export interface MigrationChecksum { name: string; checksum: string }

export const authTables = ['user', 'session', 'account', 'verification', 'rateLimit'] as const;
export const applicationTables = ['colleges', 'profiles', 'listings', 'listing_photos', 'student_requests', 'conversations', 'messages', 'orders', 'order_events', 'saved_items', 'support_tickets', 'notifications', 'verification_requests', 'business_profiles', 'deals', 'audit_logs', 'action_limits'] as const;
const readableApplicationTables = applicationTables.filter(name => name !== 'action_limits');
const accessFunctions = ['app_user_id()', 'app_is_admin()', 'app_campus()', 'app_active()', 'app_participant(uuid)', 'app_order_listing(uuid)', 'app_conversation_listing(uuid)', 'unicirq_command(jsonb)', 'app_choose_university(jsonb)', 'app_create_listing_with_photo(jsonb,bytea)'];
const forbiddenRoles = ['pg_read_all_data', 'pg_write_all_data', 'pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program'];

function finish(checks: ReadinessCheck[]): DatabaseReadinessReport { return { ok: checks.every(check => check.ok), checks }; }
function check(name: string, ok: boolean, message: string, items: string[] = []): ReadinessCheck { return { name, ok, message, ...(items.length ? { items } : {}) }; }
function names(rows: Record<string, unknown>[]): string[] { return rows.map(row => String(row.name)); }

export function inspectDatabaseTransport(connectionString: string, encrypted?: boolean): ReadinessCheck {
  const issue = postgresUrlIssue(connectionString);
  if (issue) return check('database-transport', false, issue);
  try {
    const url = new URL(connectionString);
    if (isLoopback(url.hostname)) return check('database-transport', true, 'Loopback database connection is suitable for local checks.');
    if (encrypted === false) return check('database-transport', false, 'The remote database connection did not negotiate TLS.');
    return check('database-transport', true, encrypted === true ? 'Remote TLS and certificate validation are enabled.' : 'Remote certificate validation is configured.');
  } catch { return check('database-transport', false, 'Use a valid PostgreSQL database URL.'); }
}

export async function auditRuntimeDatabase(db: DatabaseQueryable): Promise<DatabaseReadinessReport> {
  const checks: ReadinessCheck[] = [];
  try {
    await db.query('BEGIN READ ONLY');
    await db.query("SET LOCAL statement_timeout = '10s'");
    const identity = (await db.query(`SELECT current_user = session_user AS direct_login, rolcanlogin,
      NOT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication) AS restricted
      FROM pg_roles WHERE rolname = session_user`)).rows[0];
    checks.push(check('runtime-login', Boolean(identity?.direct_login && identity.rolcanlogin && identity.restricted), 'The connection must use a restricted login role directly.'));

    const elevated = await db.query(`SELECT 1 FROM pg_roles r WHERE (r.rolname = session_user OR pg_has_role(session_user,r.oid,'MEMBER'))
      AND (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolname = ANY($1::text[])) LIMIT 1`, [forbiddenRoles]);
    checks.push(check('runtime-role-memberships', elevated.rows.length === 0, 'Reachable roles must not grant owner, bypass, administration, or server-file privileges.'));

    const tables = (await db.query(`SELECT c.relname AS name,c.relrowsecurity AS rls,
      EXISTS(SELECT FROM pg_roles r WHERE (r.rolname = session_user OR pg_has_role(session_user,r.oid,'MEMBER')) AND r.oid=c.relowner) AS owned,
      EXISTS(SELECT FROM pg_roles r WHERE (r.rolname = session_user OR pg_has_role(session_user,r.oid,'MEMBER')) AND
        (has_table_privilege(r.oid,c.oid,'INSERT') OR has_table_privilege(r.oid,c.oid,'UPDATE') OR has_table_privilege(r.oid,c.oid,'DELETE') OR has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'REFERENCES') OR has_table_privilege(r.oid,c.oid,'TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'INSERT') OR has_any_column_privilege(r.oid,c.oid,'UPDATE') OR has_any_column_privilege(r.oid,c.oid,'REFERENCES'))) AS writable,
      has_table_privilege(session_user,c.oid,'SELECT') AND has_table_privilege(session_user,c.oid,'INSERT') AND has_table_privilege(session_user,c.oid,'UPDATE') AND has_table_privilege(session_user,c.oid,'DELETE') AS auth_crud,
      EXISTS(SELECT FROM pg_roles r WHERE (r.rolname = session_user OR pg_has_role(session_user,r.oid,'MEMBER')) AND
        (has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'REFERENCES') OR has_table_privilege(r.oid,c.oid,'TRIGGER') OR has_table_privilege(r.oid,c.oid,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION'))) AS extra_auth,
      EXISTS(SELECT FROM pg_policy policy WHERE policy.polrelid=c.oid AND policy.polcmd IN('r','*')
        AND (0 = ANY(policy.polroles) OR (SELECT oid FROM pg_roles WHERE rolname='unicirq_app') = ANY(policy.polroles))) AS read_policy
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p') ORDER BY c.relname`)).rows;
    const byName = new Map(tables.map(row => [String(row.name), row]));
    const missing = [...authTables, ...applicationTables].filter(name => !byName.has(name));
    checks.push(check('required-tables', missing.length === 0, 'All authentication and application tables must be present.', missing));
    const owned = names(tables.filter(row => row.owned));
    checks.push(check('table-ownership', owned.length === 0, 'Runtime and reachable roles must not own public tables.', owned));
    const unsafeTables = names(tables.filter(row => !authTables.includes(String(row.name) as typeof authTables[number]) && row.writable));
    checks.push(check('application-write-grants', unsafeTables.length === 0, 'Application writes must be available only through the protected command function.', unsafeTables));
    const missingCrud = authTables.filter(name => !byName.get(name)?.auth_crud);
    const extraAuth = authTables.filter(name => byName.get(name)?.extra_auth);
    checks.push(check('auth-table-grants', missingCrud.length === 0 && extraAuth.length === 0, 'Authentication tables require SELECT, INSERT, UPDATE, DELETE without extra privileges.', [...missingCrud, ...extraAuth]));
    const noRls = applicationTables.filter(name => byName.has(name) && !byName.get(name)?.rls);
    const noReadPolicy = readableApplicationTables.filter(name => byName.has(name) && !byName.get(name)?.read_policy);
    checks.push(check('application-row-security', noRls.length === 0 && noReadPolicy.length === 0, 'Application tables require RLS and their expected read policies.', [...new Set([...noRls, ...noReadPolicy])]));

    const schemaCreate = await db.query(`SELECT n.nspname AS name FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      AND EXISTS(SELECT FROM pg_roles r WHERE (r.rolname=session_user OR pg_has_role(session_user,r.oid,'MEMBER')) AND has_schema_privilege(r.oid,n.oid,'CREATE'))`);
    const databaseOwner = await db.query(`SELECT 1 FROM pg_roles r WHERE (r.rolname=session_user OR pg_has_role(session_user,r.oid,'MEMBER'))
      AND has_database_privilege(r.oid,current_database(),'CREATE') LIMIT 1`);
    checks.push(check('schema-and-database-creation', schemaCreate.rows.length === 0 && databaseOwner.rows.length === 0, 'Runtime roles must not own the database or create schemas or public objects.', names(schemaCreate.rows)));

    const migrationAccess = await db.query(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='unicirq_migrations' AND EXISTS(SELECT FROM pg_roles r WHERE
        (r.rolname=session_user OR pg_has_role(session_user,r.oid,'MEMBER')) AND
        (r.oid=c.relowner OR has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))`);
    checks.push(check('migration-owner-separation', migrationAccess.rows.length === 0, 'Migration-ledger access must stay with the separate operator login.', names(migrationAccess.rows)));

    const functions = (await db.query(`SELECT expected.name,p.oid IS NOT NULL AS present,
      CASE WHEN p.oid IS NULL THEN false ELSE has_function_privilege('unicirq_app',p.oid,'EXECUTE') END AS executable,
      p.prosecdef AS definer,p.proconfig AS settings,
      EXISTS(SELECT FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) privilege WHERE privilege.grantee=0 AND privilege.privilege_type='EXECUTE') AS public_execute,
      EXISTS(SELECT FROM pg_roles r WHERE (r.rolname=session_user OR pg_has_role(session_user,r.oid,'MEMBER')) AND r.oid=p.proowner) AS owned
      FROM unnest($1::text[]) AS expected(name) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||expected.name)`, [accessFunctions])).rows;
    const unavailable = names(functions.filter(row => !row.present || !row.executable));
    const unsafeCommands = names(functions.filter(row => ['unicirq_command(jsonb)', 'app_create_listing_with_photo(jsonb,bytea)'].includes(String(row.name)) &&
      (!row.definer || !Array.isArray(row.settings) || !row.settings.some(value => String(value).replace(/\s/g, '') === 'search_path=public,pg_temp'))));
    const publicFunctions = names(functions.filter(row => row.public_execute));
    const ownedFunctions = names(functions.filter(row => row.owned));
    const legacyCommands = (await db.query(`SELECT p.proname || '(jsonb)' AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='app_command_before_verification_reviews' AND EXISTS(SELECT FROM pg_roles r
        WHERE (r.rolname=session_user OR r.rolname='unicirq_app' OR pg_has_role(session_user,r.oid,'MEMBER')) AND has_function_privilege(r.oid,p.oid,'EXECUTE'))`)).rows;
    checks.push(check('protected-function-grants', unavailable.length === 0 && ownedFunctions.length === 0 && legacyCommands.length === 0 && unsafeCommands.length === 0 && publicFunctions.length === 0, 'Application policy helpers and the protected command function require restricted grants and separate ownership; superseded commands must stay owner-only.', [...new Set([...unavailable, ...ownedFunctions, ...unsafeCommands, ...publicFunctions, ...names(legacyCommands)])]));

    await db.query('SET LOCAL ROLE unicirq_app');
    const appRole = (await db.query(`SELECT current_user='unicirq_app' AS assumed,
      NOT (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreaterole OR rolcreatedb OR rolreplication) AS restricted
      FROM pg_roles WHERE rolname=current_user`)).rows[0];
    const appReads = await db.query(`SELECT expected.name FROM unnest($1::text[]) expected(name)
      WHERE to_regclass('public.'||quote_ident(expected.name)) IS NULL OR NOT has_table_privilege(current_user,to_regclass('public.'||quote_ident(expected.name)),'SELECT')`, [applicationTables]);
    checks.push(check('application-role', Boolean(appRole?.assumed && appRole.restricted) && appReads.rows.length === 0, 'The login must assume a non-login RLS role with application read grants.', names(appReads.rows)));
  } catch { checks.push(check('runtime-audit', false, 'Catalog inspection or restricted-role assumption failed. Check the runtime grants and applied migrations.')); }
  finally { try { await db.query('ROLLBACK'); } catch { checks.push(check('runtime-rollback', false, 'The read-only audit connection did not close its transaction.')); } }
  return finish(checks);
}

export async function auditMigrationLedger(db: DatabaseQueryable, expected: MigrationChecksum[]): Promise<DatabaseReadinessReport> {
  const checks: ReadinessCheck[] = [];
  try {
    await db.query('BEGIN READ ONLY');
    await db.query("SET LOCAL statement_timeout = '10s'");
    const exists = (await db.query("SELECT to_regclass('public.unicirq_migrations') IS NOT NULL AS present")).rows[0]?.present;
    if (!exists) checks.push(check('migration-ledger', false, 'The migration ledger is missing. Apply migrations with the operator connection.'));
    else {
      const applied = (await db.query('SELECT name,checksum FROM public.unicirq_migrations')).rows;
      const recorded = new Map(applied.map(row => [String(row.name), String(row.checksum)]));
      const mismatch = expected.filter(file => recorded.get(file.name) !== file.checksum).map(file => file.name);
      const expectedNames = new Set(expected.map(file => file.name));
      const unexpected = applied.filter(row => !expectedNames.has(String(row.name))).map(row => /^[a-zA-Z0-9_.-]{1,120}$/.test(String(row.name)) ? String(row.name) : 'unrecognized migration');
      checks.push(check('migration-checksums', mismatch.length === 0 && unexpected.length === 0 && expected.length > 0, 'Every repository migration must match its applied checksum.', [...mismatch, ...unexpected]));
    }
  } catch { checks.push(check('migration-audit', false, 'Migration metadata could not be inspected. Check the separate operator connection.')); }
  finally { try { await db.query('ROLLBACK'); } catch { checks.push(check('migration-rollback', false, 'The read-only migration audit did not close its transaction.')); } }
  return finish(checks);
}
