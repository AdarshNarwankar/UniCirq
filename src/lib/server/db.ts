import 'server-only';
import { Pool, types, type PoolClient } from 'pg';
import { postgresUrlIssue } from '../environment';
types.setTypeParser(1082, value => value); // Keep dates as YYYY-MM-DD, independent of server timezone.
types.setTypeParser(20, value => Number(value)); // App monetary totals are bounded well below MAX_SAFE_INTEGER.
const pools = globalThis as unknown as { unicirqPool?: Pool };
export function pool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || postgresUrlIssue(connectionString)) throw new Error('Configure a valid restricted PostgreSQL runtime connection.');
  if (!pools.unicirqPool) {
    pools.unicirqPool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 20000, connectionTimeoutMillis: 10000 });
    pools.unicirqPool.on('error', () => console.error('UniCirq idle database connection failed.'));
  }
  return pools.unicirqPool;
}
// Identity comes from a verified server session. SET LOCAL prevents pool identity leaks.
export async function withUser<T>(userId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE unicirq_app');
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
