import { cookies } from 'next/headers';
import { demoEnabled, authConfigured } from '@/lib/server/config';
import { createDemoSession } from '@/lib/server/auth';
import { getAuth } from '@/lib/server/better-auth';
import { checkOrigin, body, json, failure } from '@/lib/server/http';
import { ids } from '@/lib/seed';
export async function POST(request:Request){try{checkOrigin(request);const input=await body(request);
 if(input.action==='logout'){(await cookies()).delete('unicirq_demo');if(authConfigured()&&!demoEnabled())return getAuth().api.signOut({headers:request.headers,asResponse:true});return json({ok:true})}
 if(input.action==='demo'&&demoEnabled()&&['student','seller','business','admin','unverified'].includes(input.account)){await createDemoSession(ids[input.account as keyof typeof ids]);return json({redirect:'/'+(input.account==='seller'||input.account==='unverified'?'student':input.account)})}
 return json({error:'This sign-in method is unavailable.'},404);
 }catch(e){return failure(e)}}
