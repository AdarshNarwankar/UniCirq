import 'server-only';
import { withUser } from './db';
import { demoEnabled } from './config';
import { demoState, snapshotFor, applyCommand } from '../demo';
import type { Profile, Snapshot, Command, State, Order } from '../domain';
import { AppError } from '../policy';
const tables:Record<keyof State,string>={colleges:'colleges',profiles:'profiles',listings:'listings',requests:'student_requests',conversations:'conversations',messages:'messages',orders:'orders',orderEvents:'order_events',saved:'saved_items',tickets:'support_tickets',notifications:'notifications',verifications:'verification_requests',businesses:'business_profiles',deals:'deals',audit:'audit_logs'};
export async function readSnapshot(actor:Profile):Promise<Snapshot>{
 if(demoEnabled())return snapshotFor(demoState(),actor);
 return withUser(actor.id,async db=>{const data:Record<string,unknown>={};for(const [key,table]of Object.entries(tables)){
   const ordered=!['colleges','saved','businesses'].includes(key);
   const result=key==='orderEvents'
    ?await db.query('SELECT * FROM order_events WHERE order_id = ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 1200',[(data.orders as Order[]).map(order=>order.id)])
    :await db.query(`SELECT * FROM ${table}${ordered?' ORDER BY created_at DESC':''} LIMIT ${key==='messages'?500:200}`);
   data[key]=result.rows;
 }return JSON.parse(JSON.stringify({...data,user:actor,demo:false})) as Snapshot});
}
export async function execute(actor:Profile,command:Command){
 if(demoEnabled())return applyCommand(demoState(),actor,command);
 try{return await withUser(actor.id,async db=>{const result=await db.query(command.type==='choose_university'?'SELECT app_choose_university($1::jsonb) AS result':'SELECT unicirq_command($1::jsonb) AS result',[JSON.stringify(command)]);return result.rows[0].result as {id?:string}})}catch(error){
  const e=error as {code?:string;message?:string};if(e.code==='P0001')throw new AppError(e.message??'Action not allowed',409);if(e.code==='42501')throw new AppError('You do not have access to this action.',403);console.error('UniCirq database command failed:',e.code);throw new AppError('Unable to save. Please try again.',503);
 }
}
