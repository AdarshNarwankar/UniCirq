import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';

const connectionString = process.env.MIGRATION_DATABASE_URL;
if (!connectionString) throw new Error('Set MIGRATION_DATABASE_URL to the migration-owner connection.');
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 15000 });
try {
  await client.connect();
  await client.query("SELECT pg_advisory_lock(hashtext('unicirq_migrations'))");
  await client.query('CREATE TABLE IF NOT EXISTS unicirq_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const directory = new URL('../database/migrations/', import.meta.url);
  const files = (await readdir(directory)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  for (const name of files) {
    const sql = await readFile(new URL(name, directory), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = await client.query('SELECT checksum FROM unicirq_migrations WHERE name=$1', [name]);
    if (previous.rowCount) {
      if (previous.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}. Add a new migration instead.`);
      console.log(`Already applied: ${name}`);
      continue;
    }
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO unicirq_migrations (name,checksum) VALUES ($1,$2)', [name, checksum]);
      await client.query('COMMIT');
      console.log(`Applied: ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
} finally {
  await client.end();
}
