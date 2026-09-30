import 'server-only';
import { defineAuth } from '../auth-definition';
import { pool } from './db';
import { appOrigin, authConfigured } from './config';
function buildAuth(){
 if(!authConfigured())throw new Error('Database, auth secret and email provider must be configured.');
 if(process.env.BETTER_AUTH_SECRET!.length<32)throw new Error('BETTER_AUTH_SECRET must be at least 32 random characters.');
 return defineAuth({origin:appOrigin(),secret:process.env.BETTER_AUTH_SECRET!,database:pool(),async sendCode(email,otp){
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:process.env.EMAIL_FROM,to:[email],subject:'Your UniCirq sign-in code',text:`Your UniCirq code is ${otp}. It expires in 5 minutes. If you did not request it, ignore this email. Never share this code.`})});
  if(!response.ok)throw new Error('Email delivery failed');
 }});
}
let instance:ReturnType<typeof buildAuth>|undefined;
export const getAuth=()=>instance??=buildAuth();
