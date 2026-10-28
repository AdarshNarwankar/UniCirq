import { cookies } from 'next/headers';
import { demoEnabled, authConfigured } from '@/lib/server/config';
import { createDemoSession } from '@/lib/server/auth';
import { getAuth } from '@/lib/server/better-auth';
import { checkOrigin, body, json, failure } from '@/lib/server/http';
import { ids } from '@/lib/seed';
import { z } from 'zod';
const actionSchema=z.discriminatedUnion('action',[z.strictObject({action:z.literal('logout')}),z.strictObject({action:z.literal('demo'),account:z.enum(['student','seller','business','admin','unverified'])})]);
export async function POST(request:Request){try{checkOrigin(request);const parsed=actionSchema.safeParse(await body(request));if(!parsed.success)return json({error:'Invalid sign-in action.'},400);const input=parsed.data;
 if(input.action==='logout'){(await cookies()).delete('unicirq_demo');if(authConfigured()&&!demoEnabled())return getAuth().api.signOut({headers:request.headers,asResponse:true});return json({ok:true})}
 if(input.action==='demo'&&demoEnabled()&&['student','seller','business','admin','unverified'].includes(input.account)){await createDemoSession(ids[input.account as keyof typeof ids]);return json({redirect:'/'})}
 return json({error:'This sign-in method is unavailable.'},404);
 }catch(e){return failure(e)}}
