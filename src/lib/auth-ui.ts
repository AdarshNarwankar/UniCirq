export class AuthRequestError extends Error {
 constructor(public readonly status:number, public readonly code:string) { super('Account request failed'); }
}
export async function accountRequest(path:string, body:Record<string,unknown>) {
 let response:Response;
 try { response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)}); }
 catch { throw new AuthRequestError(0,'NETWORK'); }
 const data:unknown=await response.json().catch(()=>null);
 const record=data&&typeof data==='object'&&!Array.isArray(data)?data as Record<string,unknown>:{};
 if(response.ok&&(!data||typeof data!=='object'||Array.isArray(data)))throw new AuthRequestError(503,'INVALID_RESPONSE');
 if(!response.ok)throw new AuthRequestError(response.status,typeof record.code==='string'?record.code:'UNKNOWN');
 return record;
}
export function accountError(error:unknown):string {
 if(!(error instanceof AuthRequestError))return 'Something went wrong. Please try again.';
 if(error.status===0)return 'We could not connect. Check your connection and try again.';
 if(error.status===429)return 'Too many attempts. Please wait a minute and try again.';
 if(error.status>=500)return 'Account services are temporarily unavailable. Please try again shortly.';
 if(error.code==='PASSWORD_VERIFICATION_REQUIRED')return 'Verify using your password, or reset it with your email to secure this account.';
 if(['INVALID_OTP','OTP_EXPIRED','INVALID_VERIFICATION_CODE','TOO_MANY_ATTEMPTS'].includes(error.code))return 'That code is invalid or has expired. Try again or request a new code.';
 if(['INVALID_EMAIL_OR_PASSWORD','INVALID_PASSWORD','USER_NOT_FOUND'].includes(error.code))return 'We could not sign you in. Check your email and password, or reset your password.';
 if(['USER_ALREADY_EXISTS','USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'].includes(error.code))return 'This email may already have an account. Try signing in or reset your password.';
 if(error.code==='PASSWORD_TOO_SHORT'||error.code==='PASSWORD_TOO_LONG')return 'Choose a password between 10 and 128 characters.';
 if(error.status===401)return 'Your session has expired. Please sign in again.';
 if(error.status===403)return 'This action is not available for your account. Please try another sign-in method.';
 return 'We could not complete that request. Check your details and try again.';
}
export function googleAuthorizationUrl(value:unknown):string|null {
 if(typeof value!=='string')return null;
 try {const url=new URL(value);return url.origin==='https://accounts.google.com'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}


export function accountNeedsRecovery(error:unknown):boolean {
 return error instanceof AuthRequestError && ['PASSWORD_VERIFICATION_REQUIRED','INVALID_EMAIL_OR_PASSWORD','INVALID_PASSWORD'].includes(error.code);
}
