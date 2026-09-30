import 'server-only';
import { NextResponse } from 'next/server';
import { AppError } from '../policy';
import { appOrigin } from './config';
export function checkOrigin(request:Request){if(request.headers.get('origin')!==appOrigin())throw new AppError('Request origin is not allowed',403)}
export async function body(request:Request){const raw=await request.text();if(raw.length>12000)throw new AppError('Request is too large',413);try{return JSON.parse(raw)}catch{throw new AppError('Invalid request',400)}}
export const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
export function failure(error:unknown){if(error instanceof AppError)return json({error:error.message},error.status);console.error('UniCirq request failed',error instanceof Error?error.message:'Unknown error');return json({error:'Something went wrong. Please try again.'},500)}
const buckets=globalThis as unknown as { unicirqLimits?:Map<string,{count:number;until:number}> };
export function localLimit(key:string,max=60){const map=buckets.unicirqLimits??=new Map();const now=Date.now();if(map.size>5000)for(const [k,v]of map)if(v.until<now)map.delete(k);const b=map.get(key);if(!b||b.until<now){map.set(key,{count:1,until:now+60000});return}if(b.count>=max)throw new AppError('Please wait a minute before trying again.',429);b.count++}
