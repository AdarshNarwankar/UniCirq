import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmailDeliveryError, sendSetupEmail, sendSignInCode, type EmailConfiguration, type OtpPurpose } from '../src/lib/email';

type GmailConfiguration = Extract<EmailConfiguration, { transport: 'gmail' }>;
type SmtpFactory = NonNullable<GmailConfiguration['smtpFactory']>;
type SmtpOptions = Parameters<SmtpFactory>[0];
type SmtpMessage = Parameters<ReturnType<SmtpFactory>['sendMail']>[0];
const recipient = 'student@example.test';
const gmail: Omit<GmailConfiguration, 'smtpFactory'> = {
  transport: 'gmail', user: 'unicirq.test@gmail.com', appPassword: 'abcd efgh ijkl mnop',
  from: 'UniCirq <UNICIRQ.TEST@gmail.com>',
};
const accepted = () => ({ accepted: [recipient], rejected: [] });
function sanitized(error: unknown) {
  assert.ok(error instanceof EmailDeliveryError);
  assert.equal(error.message, 'Email delivery is temporarily unavailable. Please try again.');
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(JSON.stringify(error), /private|123456|student@|smtp-response/);
  return true;
}

test('Gmail uses authenticated implicit TLS and one explicit mailbox, awaits acceptance, then closes', async () => {
  let options: SmtpOptions | undefined;
  let message: SmtpMessage | undefined;
  let closeCount = 0;
  let finished = false;
  let accept!: (info: ReturnType<typeof accepted>) => void;
  const pending = new Promise<ReturnType<typeof accepted>>(resolve => { accept = resolve; });
  const smtpFactory: SmtpFactory = value => {
    options = value;
    return { async sendMail(value) { message = value; return pending; }, close() { closeCount++; } };
  };
  const sending = sendSetupEmail(recipient, { ...gmail, timeoutMs: 60000, smtpFactory }).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(closeCount, 0);
  assert.deepEqual(options, {
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: gmail.user, pass: 'abcdefghijklmnop' },
    tls: { rejectUnauthorized: true, servername: 'smtp.gmail.com' },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 10000, dnsTimeout: 10000,
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
  assert.ok(message);
  assert.deepEqual(message.from, { name: 'UniCirq', address: gmail.user });
  assert.deepEqual(message.to, [{ address: recipient }]);
  assert.deepEqual(message.envelope, { from: gmail.user, to: [recipient] });
  assert.match(message.text, /contains no sign-in code/);
  assert.match(message.html, /UniCirq/);
  accept(accepted());
  await sending;
  assert.equal(finished, true);
  assert.equal(closeCount, 1);
});

test('Gmail preserves branded six-digit OTP messages and each code purpose', async () => {
  for (const type of ['sign-in', 'email-verification', 'forget-password'] as OtpPurpose[]) {
    let message: SmtpMessage | undefined;
    let closed = false;
    await sendSignInCode({ email: recipient, otp: '123456', type }, {
      ...gmail, smtpFactory: () => ({ async sendMail(value: SmtpMessage) { message = value; return accepted(); }, close() { closed = true; } }),
    });
    assert.ok(message);
    assert.match(message.text, /Your Campus, Connected/);
    assert.match(message.text, /123456/);
    assert.match(message.text, /5 minutes/);
    assert.match(message.html, /123456/);
    assert.match(message.subject, type === 'forget-password' ? /Reset/ : type === 'email-verification' ? /Verify/ : /sign-in/);
    assert.doesNotMatch(JSON.stringify({ from: message.from, to: message.to, subject: message.subject, envelope: message.envelope }), /123456/);
    assert.equal(closed, true);
  }
});

test('invalid Gmail credentials, spoofed sender, recipient injection and invalid deadlines create no transport', async () => {
  let created = 0;
  const smtpFactory: SmtpFactory = () => { created++; throw new Error('Must not create a transport'); };
  const invalid: Partial<GmailConfiguration>[] = [
    { user: 'sender@example.test' }, { user: 'sender@gmail.com.evil.test' },
    { user: 'sender@gmail.com\r\nBcc:other@example.test' },
    { appPassword: 'normal-password' }, { appPassword: 'abcd efgh ijkl 1234' },
    { appPassword: 'abcdefghijklmnopq' }, { appPassword: 'abcd\tefghijklmnop' },
    { from: 'Other <other@gmail.com>' }, { from: 'UniCirq <unicirq.test@gmail.com>\r\nBcc:other@example.test' },
    { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: NaN }, { timeoutMs: Infinity },
  ];
  for (const override of invalid) await assert.rejects(sendSetupEmail(recipient, { ...gmail, ...override, smtpFactory }), sanitized);
  for (const address of ['student@example.test\r\nBcc:other@example.test', 'student,other@example.test', 'student;other@example.test', 'Group:student@example.test;', 'student\u0000@example.test'])
    await assert.rejects(sendSetupEmail(address, { ...gmail, smtpFactory }), sanitized);
  await assert.rejects(sendSignInCode({ email: recipient, otp: '12<script>' }, { ...gmail, smtpFactory }), sanitized);
  await assert.rejects(sendSignInCode({ email: recipient, otp: '123456', type: 'invalid' as OtpPurpose }, { ...gmail, smtpFactory }), sanitized);
  assert.equal(created, 0);
});

test('Gmail factory and SMTP failures expose a fixed error and always close an existing transport', async () => {
  await assert.rejects(sendSetupEmail(recipient, { ...gmail, smtpFactory: () => { throw new Error('private-app-password smtp-response'); } }), sanitized);
  let closed = 0;
  const smtpFactory: SmtpFactory = () => ({
    async sendMail() { throw Object.assign(new Error('private-app-password student@example.test 123456 smtp-response'), { code: 'EAUTH', response: 'private-smtp-response' }); },
    close() { closed++; throw new Error('private-close-response'); },
  });
  await assert.rejects(sendSetupEmail(recipient, { ...gmail, smtpFactory }), sanitized);
  assert.equal(closed, 1);
});

test('Gmail refuses missing, unexpected or rejected recipient acceptance results', async () => {
  for (const info of [
    {}, { accepted: [], rejected: [] }, { accepted: ['other@example.test'], rejected: [] },
    { accepted: [recipient, 'other@example.test'], rejected: [] },
    { accepted: [recipient], rejected: [recipient] }, { accepted: [recipient] },
  ]) {
    let closed = false;
    await assert.rejects(sendSetupEmail(recipient, {
      ...gmail, smtpFactory: () => ({ async sendMail() { return info; }, close() { closed = true; } }),
    }), sanitized);
    assert.equal(closed, true);
  }
});

test('Gmail send deadline rejects a stalled provider and closes without exposing SMTP data', { timeout: 2000 }, async () => {
  let closed = false;
  let options: SmtpOptions | undefined;
  await assert.rejects(sendSetupEmail(recipient, {
    ...gmail, timeoutMs: 20,
    smtpFactory: (value: SmtpOptions) => { options = value; return { sendMail: () => new Promise<never>(() => {}), close() { closed = true; } }; },
  }), sanitized);
  assert.ok(options);
  assert.equal(options.connectionTimeout, 20);
  assert.equal(options.socketTimeout, 20);
  assert.equal(closed, true);
});

test('Gmail cleanup errors do not turn confirmed acceptance into a failure and trigger duplicate sends', async () => {
  let sent = 0;
  await sendSetupEmail(recipient, {
    ...gmail, smtpFactory: () => ({ async sendMail() { sent++; return accepted(); }, close() { throw new Error('private-close-response'); } }),
  });
  assert.equal(sent, 1);
});

test('legacy and explicit Resend configurations still use the existing fixed HTTP endpoint', async () => {
  for (const transport of [undefined, 'resend'] as const) {
    let requested = false;
    await sendSetupEmail(recipient, {
      transport, apiKey: 're_private_test_key', from: 'UniCirq <signin@example.test>',
      fetcher: async (input, options) => {
        requested = true;
        assert.equal(input, 'https://api.resend.com/emails');
        assert.equal(options?.redirect, 'error');
        assert.ok(options?.signal);
        assert.deepEqual(JSON.parse(String(options?.body)).to, [recipient]);
        return Response.json({ id: 'accepted-test-message' });
      },
    });
    assert.equal(requested, true);
  }
});
