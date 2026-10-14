import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authCapabilitiesFor, inspectEmailEnvironment, inspectRuntimeEnvironment } from '../src/lib/environment';

const core = {
  APP_URL: 'https://unicirq.example',
  DATABASE_URL: 'postgresql://runtime:test-only@database.example/unicirq?sslmode=verify-full',
  BETTER_AUTH_SECRET: 'test-only-secret-with-at-least-32-characters',
};
const gmail = {
  EMAIL_PROVIDER: 'gmail', GMAIL_USER: 'sender@gmail.com',
  GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop', EMAIL_FROM: 'UniCirq <sender@gmail.com>',
};

test('Gmail email authentication requires its own complete configuration and the core database settings', () => {
  assert.equal(inspectEmailEnvironment(gmail, { hosted: true }).ok, true);
  assert.deepEqual(authCapabilitiesFor({ ...core, ...gmail }, { hosted: true }), { base: true, email: true, google: false });
  assert.equal(authCapabilitiesFor(gmail, { hosted: true }).email, false);
  assert.equal(inspectRuntimeEnvironment({ ...core, ...gmail }, { hosted: true }).ok, true);
});

test('Gmail rejects mismatched senders, non-Gmail accounts and malformed App Passwords', () => {
  for (const change of [
    { GMAIL_USER: 'sender@example.com' }, { EMAIL_FROM: 'Other <different@gmail.com>' },
    { EMAIL_FROM: 'sender@gmail.com\r\nBcc: other@example.test' }, { GMAIL_APP_PASSWORD: '' },
    { GMAIL_APP_PASSWORD: 'ordinary-password-123' }, { GMAIL_APP_PASSWORD: 'abcd\nefghijklmnop' },
    { GMAIL_APP_PASSWORD: 'abcdefghijklmnop\r\n' },
  ]) assert.equal(inspectEmailEnvironment({ ...gmail, ...change }, { hosted: true }).ok, false);
});

test('a broken or unknown selected provider cannot fall back to another provider', () => {
  const resend = { RESEND_API_KEY: 're_test_only_key', EMAIL_FROM: 'UniCirq <sender@example.com>' };
  assert.equal(inspectEmailEnvironment(resend, { hosted: true }).ok, true);
  assert.equal(inspectEmailEnvironment({ ...resend, EMAIL_PROVIDER: 'unknown' }, { hosted: true }).ok, false);
  assert.equal(inspectEmailEnvironment({ ...resend, EMAIL_PROVIDER: 'gmail' }, { hosted: true }).ok, false);
  assert.equal(inspectEmailEnvironment({ ...gmail, EMAIL_PROVIDER: 'resend' }, { hosted: true }).ok, false);
});

test('Gmail diagnostics never contain private credentials and reject public App Password variables', () => {
  const report = inspectRuntimeEnvironment({ ...core, ...gmail, GMAIL_APP_PASSWORD: 'private-invalid-password' }, { hosted: true });
  assert.equal(report.ok, false);
  assert.doesNotMatch(JSON.stringify(report), /private-invalid-password|abcd efgh|test-only-secret|test-only@/);
  assert.equal(authCapabilitiesFor({ ...core, ...gmail, NEXT_PUBLIC_GMAIL_APP_PASSWORD: 'exposed-test-secret' }, { hosted: true }).base, false);
});
