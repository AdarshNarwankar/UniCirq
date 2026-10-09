import test from 'node:test';
import assert from 'node:assert/strict';
import {accountError, accountNeedsRecovery, accountRequest, AuthRequestError, googleAuthorizationUrl} from '../src/lib/auth-ui';

test('Google handoff accepts only the exact secure Google accounts origin',()=>{
 const valid='https://accounts.google.com/o/oauth2/v2/auth?client_id=sample&state=sample';
 assert.equal(googleAuthorizationUrl(valid),valid);
 for(const value of [null,{},'/login','javascript:alert(1)','http://accounts.google.com','https://accounts.google.com:8443','https://accounts.google.com.evil.test','https://evil.test/accounts.google.com','https://user:pass@accounts.google.com','//accounts.google.com']) assert.equal(googleAuthorizationUrl(value),null);
});

test('errors expose fixed friendly copy and identify credential recovery',()=>{
 const secret='private-database-token-that-must-not-appear';
 for(const error of [new Error(secret),new AuthRequestError(503,secret),new AuthRequestError(400,secret)]) assert.ok(!accountError(error).includes(secret));
 assert.match(accountError(new AuthRequestError(429,'UNKNOWN')),/wait a minute/i);
 assert.match(accountError(new AuthRequestError(0,'NETWORK')),/connection/i);
 assert.match(accountError(new AuthRequestError(403,'PASSWORD_VERIFICATION_REQUIRED')),/Verify using your password/);
 assert.equal(accountNeedsRecovery(new AuthRequestError(403,'PASSWORD_VERIFICATION_REQUIRED')),true);
 assert.equal(accountNeedsRecovery(new AuthRequestError(401,'INVALID_EMAIL_OR_PASSWORD')),true);
 assert.equal(accountNeedsRecovery(new AuthRequestError(400,'INVALID_OTP')),false);
});

test('request includes same-origin cookies and an expiring signal without external network',async t=>{
 let captured:RequestInit|undefined;
 t.mock.method(globalThis,'fetch',async(input:unknown,init?:RequestInit)=>{assert.equal(input,'/api/auth/email-otp/verify-email');captured=init;return Response.json({status:true});});
 const result=await accountRequest('/api/auth/email-otp/verify-email',{email:'student@example.test',otp:'123456',password:'test-only-password'});
 assert.deepEqual(result,{status:true});assert.equal(captured?.credentials,'same-origin');assert.equal(captured?.method,'POST');assert.ok(captured?.signal instanceof AbortSignal);
 assert.deepEqual(JSON.parse(captured?.body as string),{email:'student@example.test',otp:'123456',password:'test-only-password'});
});

test('request discards server diagnostic messages and preserves only status/code',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({code:'INVALID_EMAIL_OR_PASSWORD',message:'secret-in-diagnostic'},{status:401}));
 await assert.rejects(accountRequest('/api/auth/sign-in/email',{}),error=>{
  assert.ok(error instanceof AuthRequestError);assert.equal(error.status,401);assert.equal(error.code,'INVALID_EMAIL_OR_PASSWORD');assert.ok(!error.message.includes('secret'));assert.ok(accountNeedsRecovery(error));return true;
 });
});

test('request maps network failures to fixed errors',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('private-network-details');});
 await assert.rejects(accountRequest('/api/auth/sign-in/email',{}),error=>{assert.ok(error instanceof AuthRequestError);assert.equal(error.code,'NETWORK');assert.equal(error.status,0);assert.ok(!error.message.includes('private'));return true;});
});

test('request rejects malformed successful responses and sanitizes non-JSON failures',async t=>{
 const responses=[new Response('<html>proxy error</html>'),Response.json(null),Response.json([]),new Response('private-hostname',{status:503})];
 t.mock.method(globalThis,'fetch',async()=>responses.shift()!);
 for(let i=0;i<4;i++)await assert.rejects(accountRequest('/api/auth/sign-in/email',{}),error=>{assert.ok(error instanceof AuthRequestError);assert.equal(error.status,503);assert.ok(!accountError(error).includes('private'));return true;});
});
