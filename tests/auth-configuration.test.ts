import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authCapabilitiesFor, inspectRuntimeEnvironment } from '../src/lib/environment';
import { needsUniversity, roleDestination } from '../src/lib/auth-policy';
import { sendSignInCode, type OtpPurpose } from '../src/lib/email';
const core = { APP_URL: 'https://unicirq.example', DATABASE_URL: 'postgresql://runtime:private-test-password@db.example/campus?sslmode=verify-full', BETTER_AUTH_SECRET: 'private-test-secret-over-thirty-two-characters' };
const google = { GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'private-test-google-secret' };
const email = { RESEND_API_KEY: 're_private_test_key', EMAIL_FROM: 'UniCirq <login@unicirq.example>' };
test('Google can be configured independently from an email delivery provider', () => {
  assert.deepEqual(authCapabilitiesFor({ ...core, ...google }), { base: true, email: false, google: true });
  assert.equal(inspectRuntimeEnvironment({ ...core, ...google }).ok, true);
  assert.deepEqual(authCapabilitiesFor({ ...core, ...email }), { base: true, email: true, google: false });
});
test('partial Google credentials never enable Google or disable a working email method', () => {
  const env = { ...core, ...email, GOOGLE_CLIENT_ID: google.GOOGLE_CLIENT_ID };
  assert.deepEqual(authCapabilitiesFor(env), { base: true, email: true, google: false });
  assert.equal(inspectRuntimeEnvironment(env).ok, false);
  assert.doesNotMatch(JSON.stringify(inspectRuntimeEnvironment(env)), /private-test-password|private-test-google-secret/);
});
test('public Google secrets, missing origin, bad database and hosted owner credentials fail closed', () => {
  for (const extra of [{ NEXT_PUBLIC_GOOGLE_CLIENT_SECRET: 'leaked' }, { APP_URL: '' }, { DATABASE_URL: 'prisma+postgres://invalid' }, { VERCEL: '1', MIGRATION_DATABASE_URL: 'owner-credential' }]) {
    assert.deepEqual(authCapabilitiesFor({ ...core, ...email, ...google, ...extra }), { base: false, email: false, google: false });
  }
});
test('university routing depends on server profile rather than verification or requested role', () => {
  assert.equal(needsUniversity({ role: 'student', college_id: null }), true);
  assert.equal(roleDestination({ role: 'student', college_id: null }), '/onboarding');
  assert.equal(roleDestination({ role: 'student', college_id: 'selected' }), '/student');
  assert.equal(roleDestination({ role: 'business', college_id: 'selected' }), '/business');
  assert.equal(roleDestination({ role: 'admin', college_id: null }), '/admin');
});
test('verification and password recovery emails explain their own code purpose', async () => {
  for (const type of ['sign-in', 'email-verification', 'forget-password'] as OtpPurpose[]) {
    const fetcher: typeof fetch = async (_, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.match(payload.text, /123456/);
      assert.match(payload.text, /5 minutes/);
      assert.match(payload.subject, type === 'forget-password' ? /Reset/ : type === 'email-verification' ? /Verify/ : /sign-in/);
      return Response.json({ id: 'provider-accepted' });
    };
    await sendSignInCode({ email: 'student@example.test', otp: '123456', type }, { apiKey: email.RESEND_API_KEY, from: email.EMAIL_FROM, fetcher });
  }
});
