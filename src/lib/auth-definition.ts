import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { emailOTP } from 'better-auth/plugins';
import { randomUUID } from 'node:crypto';
// Dependency injection lets integration tests exercise the exact production auth settings.
export function defineAuth({database,origin,secret,sendCode}:{database:BetterAuthOptions['database'];origin:string;secret:string;sendCode:(email:string,otp:string)=>Promise<void>}){
 return betterAuth({appName:'UniCirq',baseURL:origin,secret,database,trustedOrigins:[origin],
 advanced:{database:{generateId:()=>randomUUID()}},
 session:{expiresIn:60*60*24*7,updateAge:60*60*12,cookieCache:{enabled:false}},
 rateLimit:{enabled:true,storage:'database',window:60,max:30,customRules:{'/email-otp/send-verification-otp':{window:60,max:3},'/sign-in/email-otp':{window:60,max:5}}},
 plugins:[emailOTP({otpLength:6,expiresIn:300,allowedAttempts:3,storeOTP:'hashed',async sendVerificationOTP({email,otp}){await sendCode(email,otp)}})]});
}
