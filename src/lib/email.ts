import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { senderAddress, validEmail } from './environment';
export type OtpPurpose = 'sign-in' | 'email-verification' | 'forget-password';
type GmailSmtpOptions = {
  host: 'smtp.gmail.com'; port: 465; secure: true;
  auth: { user: string; pass: string };
  tls: { rejectUnauthorized: true; servername: 'smtp.gmail.com' };
  connectionTimeout: number; greetingTimeout: number; socketTimeout: number; dnsTimeout: number;
  disableFileAccess: true; disableUrlAccess: true; logger: false; debug: false;
};
type GmailMessage = {
  from: { name: string; address: string }; to: { address: string }[];
  envelope: { from: string; to: string[] }; subject: string; text: string; html: string;
};
type GmailTransport = {
  sendMail(message: GmailMessage): Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
  close(): void;
};
export type EmailConfiguration =
  | { transport?: 'resend'; apiKey: string; from: string; fetcher?: typeof fetch; timeoutMs?: number }
  | { transport: 'gmail'; user: string; appPassword: string; from: string; timeoutMs?: number;
      smtpFactory?: (options: GmailSmtpOptions) => GmailTransport };
type Message = { email: string; subject: string; text: string; html: string };
export class EmailDeliveryError extends Error {
  constructor() { super('Email delivery is temporarily unavailable. Please try again.'); this.name = 'EmailDeliveryError'; }
}
async function sendGmail(message: Message, configuration: Extract<EmailConfiguration, { transport: 'gmail' }>) {
  const { user, from, smtpFactory = options => nodemailer.createTransport(options) } = configuration;
  const password = configuration.appPassword.replace(/ /g, '');
  const address = senderAddress(from);
  // Send one explicit mailbox, never a header string that can expand into more recipients.
  if (!validEmail(user) || !user.toLowerCase().endsWith('@gmail.com') || !/^[a-z]{16}$/i.test(password) ||
      !address || address.toLowerCase() !== user.toLowerCase() ||
      !validEmail(message.email) || /[,;:\u0000-\u001f\u007f"\\()]/.test(message.email) ||
      /[\r\n\u0000]/.test(message.subject)) throw new EmailDeliveryError();
  const requestedTimeout = configuration.timeoutMs ?? 10000;
  if (!Number.isFinite(requestedTimeout) || requestedTimeout <= 0) throw new EmailDeliveryError();
  const timeout = Math.min(10000, Math.ceil(requestedTimeout));
  let transport: GmailTransport | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    transport = smtpFactory({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user, pass: password }, tls: { rejectUnauthorized: true, servername: 'smtp.gmail.com' },
      connectionTimeout: timeout, greetingTimeout: timeout, socketTimeout: timeout, dnsTimeout: timeout,
      disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
    });
    const expired = new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new EmailDeliveryError()), timeout); });
    const info = await Promise.race([transport.sendMail({
      from: { name: 'UniCirq', address: user }, to: [{ address: message.email }],
      envelope: { from: user, to: [message.email] }, subject: message.subject, text: message.text, html: message.html,
    }), expired]);
    if (!Array.isArray(info?.accepted) || info.accepted.length !== 1 ||
        typeof info.accepted[0] !== 'string' || info.accepted[0].toLowerCase() !== message.email.toLowerCase() ||
        !Array.isArray(info.rejected) || info.rejected.length !== 0) throw new EmailDeliveryError();
    // SMTP acceptance is not proof of inbox delivery. Never log addresses or SMTP responses.
  } catch { throw new EmailDeliveryError(); }
  finally {
    if (deadline !== undefined) clearTimeout(deadline);
    try { transport?.close(); } catch { /* Cleanup must not expose provider details or replace the send result. */ }
  }
}
async function send(message: Message, configuration: EmailConfiguration) {
  if (configuration.transport === 'gmail') return sendGmail(message, configuration);
  const { apiKey, from, fetcher = fetch, timeoutMs = 10000 } = configuration;
  if (!/^re_[A-Za-z0-9_-]+$/.test(apiKey) || !senderAddress(from) || !validEmail(message.email)) throw new EmailDeliveryError();
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ from, to: [message.email], subject: message.subject, text: message.text, html: message.html }),
    });
    if (!response.ok) throw new EmailDeliveryError();
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !value.id) throw new EmailDeliveryError();
    // Acceptance does not prove inbox delivery. Never log recipients, codes or provider bodies.
  } catch { throw new EmailDeliveryError(); }
}
export async function sendSignInCode({ email, otp, type = 'sign-in' }: { email: string; otp: string; type?: OtpPurpose }, configuration: EmailConfiguration) {
  if (!/^\d{6}$/.test(otp) || !['sign-in', 'email-verification', 'forget-password'].includes(type)) throw new EmailDeliveryError();
  const subject = type === 'email-verification' ? 'Verify your UniCirq email' : type === 'forget-password' ? 'Reset your UniCirq password' : 'Your UniCirq sign-in code';
  const action = type === 'email-verification' ? 'email verification' : type === 'forget-password' ? 'password reset' : 'sign-in';
  await send({ email, subject,
    text: 'UniCirq — Your Campus, Connected.\n\nYour ' + action + ' code is ' + otp + '. It expires in 5 minutes.\n\nNever share this code. If you did not request it, ignore this email.',
    html: '<html lang="en"><body style="margin:0;background:#f2f6ff;font-family:Arial,sans-serif;color:#10204b"><main style="max-width:480px;margin:32px auto;padding:32px;background:#fff;border-radius:16px"><h1 style="color:#075bff">UniCirq</h1><p>Your Campus, Connected.</p><h2>' + subject + '</h2><p style="font-size:32px;font-weight:bold;letter-spacing:8px">' + otp + '</p><p>This code expires in 5 minutes.</p><p>Never share this code. If you did not request it, ignore this email.</p></main></body></html>' }, configuration);
}
export async function sendSetupEmail(email: string, configuration: EmailConfiguration) {
  await send({ email, subject: 'UniCirq email setup check',
    text: 'UniCirq — Your Campus, Connected.\n\nThis email checks your configured UniCirq sender. It contains no sign-in code. If you requested this check, confirm it arrived in your inbox.',
    html: '<html lang="en"><body><h1>UniCirq</h1><p>Your Campus, Connected.</p><p>Your configured UniCirq sender sent this setup check. It contains no sign-in code.</p></body></html>' }, configuration);
}
