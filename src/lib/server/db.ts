import 'server-only';
import { Pool, types, type PoolClient } from 'pg';
types.setTypeParser(1082,value=>value); // Keep dates as YYYY-MM-DD, independent of server timezone.
types.setTypeParser(20,value=>Number(value)); // App monetary totals are bounded well below MAX_SAFE_INTEGER.
const pools=globalThis as unknown as {unicirqPool?:Pool};
export function pool(){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is not configured');return pools.unicirqPool??=new Pool({connectionString:process.env.DATABASE_URL,max:5,idleTimeoutMillis:20000,connectionTimeoutMillis:10000})}
// Identity comes from a verified server session. SET LOCAL prevents pool identity leaks.
export async function withUser<T>(userId:string,fn:(client:PoolClient)=>Promise<T>):Promise<T>{
 const client=await pool().connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE unicirq_app');await client.query("SELECT set_config('app.user_id', $1, true)",[userId]);const result=await fn(client);await client.query('COMMIT');return result}catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
