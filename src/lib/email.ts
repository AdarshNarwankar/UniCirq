import { randomUUID } from 'node:crypto';
import { senderAddress, validEmail } from './environment';
export type OtpPurpose = 'sign-in' | 'email-verification' | 'forget-password';
type EmailConfiguration = { apiKey: string; from: string; fetcher?: typeof fetch; timeoutMs?: number };
type Message = { email: string; subject: string; text: string; html: string };
export class EmailDeliveryError extends Error {
  constructor() { super('Email delivery is temporarily unavailable. Please try again.'); this.name = 'EmailDeliveryError'; }
}
async function send(message: Message, { apiKey, from, fetcher = fetch, timeoutMs = 10000 }: EmailConfiguration) {
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
