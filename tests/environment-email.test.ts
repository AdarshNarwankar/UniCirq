import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectRuntimeEnvironment, originIssue, postgresUrlIssue } from '../src/lib/environment';
import { EmailDeliveryError, sendSetupEmail, sendSignInCode } from '../src/lib/email';

const environment = {
  APP_URL: 'https://unicirq.example',
  DATABASE_URL: 'postgresql://runtime:private-password@database.example/unicirq?sslmode=verify-full',
  BETTER_AUTH_SECRET: 'private-test-secret-with-at-least-32-characters',
  RESEND_API_KEY: 're_private_test_key',
  EMAIL_FROM: 'UniCirq <signin@unicirq.example>',
};

test('configuration checks fail closed without revealing secret values', () => {
  const healthy = inspectRuntimeEnvironment(environment, { hosted: true });
  assert.equal(healthy.ok, true);
  const broken = inspectRuntimeEnvironment({ ...environment, BETTER_AUTH_SECRET: 'short', RESEND_API_KEY: '', DATABASE_URL: 'postgresql://owner:sensitive@database.example/app?sslmode=disable' });
  assert.equal(broken.ok, false);
  assert.equal(broken.checks.find(check => check.name === 'RESEND_API_KEY')?.status, 'missing');
  assert.doesNotMatch(JSON.stringify(broken), /sensitive|private-password|re_private_test_key/);
});

test('hosted sign-in requires canonical HTTPS origins and private runtime credentials', () => {
  assert.equal(originIssue('http://127.0.0.1:3000', false), undefined);
  for (const origin of ['http://127.0.0.1:3000', 'http://unicirq.example', 'https://unicirq.example/student', 'https://user:password@unicirq.example', 'https://unicirq.example?redirect=elsewhere'])
    assert.ok(originIssue(origin, true));
  assert.equal(inspectRuntimeEnvironment({ ...environment, VERCEL: '1', MIGRATION_DATABASE_URL: 'owner-secret' }).ok, false);
  assert.equal(inspectRuntimeEnvironment({ ...environment, NEXT_PUBLIC_RESEND_API_KEY: 'leaked-key' }).ok, false);
  assert.equal(inspectRuntimeEnvironment({ ...environment, EMAIL_FROM: 'UniCirq <onboarding@resend.dev>' }, { hosted: true }).ok, false);
});

test('database URL validation rejects remote TLS downgrades and local-host query overrides', () => {
  assert.equal(postgresUrlIssue(environment.DATABASE_URL), undefined);
  assert.equal(postgresUrlIssue('postgresql://runtime@localhost/app'), undefined);
  for (const connection of [
    'mongodb://user:password@database.example/app',
    'postgresql://user:password@database.example/app?sslmode=require',
    'postgresql://user:password@database.example/app?sslmode=no-verify',
    'postgresql://user:password@localhost/app?host=database.example',
    'postgresql://user:password@database.example/app?sslmode=verify-full&sslmode=disable',
    'postgresql://user:password@database.example/app?sslmode=verify-full&sslrejectunauthorized=false',
  ]) assert.ok(postgresUrlIssue(connection));
});

test('sender validation prevents line breaks and configuration is safe in local database mode', () => {
  assert.equal(inspectRuntimeEnvironment({ ...environment, APP_URL: 'http://localhost:3000', DATABASE_URL: 'postgresql://runtime@localhost/app' }, { hosted: false }).ok, true);
  assert.equal(inspectRuntimeEnvironment({ ...environment, EMAIL_FROM: 'hello@unicirq.example\r\nBcc: injected@example.test' }).ok, false);
});

test('sign-in email sends branded HTML and text with a deadline and no code in headers', async () => {
  let called = 0;
  const fetcher: typeof fetch = async (input, init) => {
    called++;
    assert.equal(input, 'https://api.resend.com/emails');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), `Bearer ${environment.RESEND_API_KEY}`);
    assert.doesNotMatch(headers.get('Idempotency-Key') ?? '', /123456|student/);
    const payload = JSON.parse(String(init?.body));
    assert.deepEqual(payload.to, ['student@example.test']);
    assert.match(payload.html, /123456/);
    assert.match(payload.text, /Your Campus, Connected/);
    assert.match(payload.text, /5 minutes/);
    return Response.json({ id: 'provider-accepted-message' });
  };
  await sendSignInCode({ email: 'student@example.test', otp: '123456' }, { apiKey: environment.RESEND_API_KEY, from: environment.EMAIL_FROM, fetcher });
  assert.equal(called, 1);
});

test('invalid codes and recipients fail before making an email request', async () => {
  let called = false;
  const fetcher: typeof fetch = async () => { called = true; return Response.json({ id: 'unused' }); };
  const configuration = { apiKey: environment.RESEND_API_KEY, from: environment.EMAIL_FROM, fetcher };
  await assert.rejects(sendSignInCode({ email: 'student@example.test', otp: '<script>' }, configuration), EmailDeliveryError);
  await assert.rejects(sendSetupEmail('student@example.test\nother@example.test', configuration), EmailDeliveryError);
  assert.equal(called, false);
});

test('provider failures, network errors and malformed success bodies expose only a fixed error', async () => {
  const fetchers: typeof fetch[] = [
    async () => Response.json({ message: 'sensitive-provider-response' }, { status: 403 }),
    async () => { throw new Error('private-key-and-recipient'); },
    async () => Response.json({ message: 'sensitive-provider-response' }),
    async () => new Response('invalid-json'),
  ];
  for (const fetcher of fetchers) {
    await assert.rejects(sendSetupEmail('student@example.test', { apiKey: environment.RESEND_API_KEY, from: environment.EMAIL_FROM, fetcher }), error => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.doesNotMatch(error.message, /sensitive|private-key|recipient/);
      return true;
    });
  }
});
