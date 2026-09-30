import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'node:crypto';
import { demoEnabled, authConfigured } from './config';
import { getAuth } from './better-auth';
import { withUser } from './db';
import { demoState } from '../demo';
import { AppError } from '../policy';
import type { Profile, Role } from '../domain';
const signing=globalThis as unknown as { unicirqSecret?:Uint8Array };
const secret=()=>signing.unicirqSecret??=new Uint8Array(randomBytes(32));
export async function createDemoSession(userId:string){
 if(!demoEnabled())throw new AppError('Demo sign-in is disabled',404);
 const token=await new SignJWT({sub:userId}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('8h').setIssuer('unicirq-local').setAudience('unicirq-demo').sign(secret());
 (await cookies()).set('unicirq_demo',token,{httpOnly:true,sameSite:'lax',secure:false,path:'/',maxAge:28800});
}
export async function currentUser():Promise<Profile|null>{
 if(demoEnabled()){
  const token=(await cookies()).get('unicirq_demo')?.value;if(!token)return null;
  try{const {payload}=await jwtVerify(token,secret(),{issuer:'unicirq-local',audience:'unicirq-demo',algorithms:['HS256']});return demoState().profiles.find(p=>p.id===payload.sub&&!p.suspended)??null}catch{return null}
 }
 if(!authConfigured())return null;
 const session=await getAuth().api.getSession({headers:await headers()});if(!session?.user.emailVerified)return null;
 return withUser(session.user.id,async db=>{const result=await db.query<Profile>('SELECT * FROM profiles WHERE id=$1',[session.user.id]);return result.rows[0]&&!result.rows[0].suspended?result.rows[0]:null});
}
export async function requirePageRole(role:Role){const user=await currentUser();if(!user)redirect('/login');if(user.role!==role)redirect('/'+user.role);return user}
export async function requireApiUser(){const user=await currentUser();if(!user)throw new AppError('Sign in to continue',401);return user}
