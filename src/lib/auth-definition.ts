import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import { randomUUID } from 'node:crypto';
import { dypiuMailbox, googleUniversityMailbox, type UniversityEmailProof } from './university-email';

export type EmailCodeType = 'sign-in' | 'email-verification' | 'forget-password';

// Dependency injection lets integration tests exercise the exact production settings.
export function defineAuth({
  database, origin, secret, sendCode, emailEnabled = true, google, onUniversityEmailVerified,
}: {
  database: BetterAuthOptions['database'];
  origin: string;
  secret: string;
  sendCode: (email: string, otp: string, type?: EmailCodeType) => Promise<void>;
  emailEnabled?: boolean;
  google?: { clientId: string; clientSecret: string };
  onUniversityEmailVerified?: (proof: UniversityEmailProof) => Promise<void>;
}) {
  // Provider evidence is bound to one authentication request. Keeping it out of
  // user metadata prevents signup fields or another request from forging proof.
  const googleMailboxEvidence = new WeakMap<object, string>();
  return betterAuth({
    appName: 'UniCirq', baseURL: origin, secret, database, trustedOrigins: [origin],
    logger: { level: 'warn', log: level => { console.error('UniCirq authentication event: ' + level); } },
    advanced: { database: { generateId: () => randomUUID() } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 12, cookieCache: { enabled: false } },
    user: {
      validateUserInfo({ user, source }, context) {
        if (source.method !== 'oauth' || source.oauth?.providerId !== 'google' || user.emailVerified !== true) return;
        const email = googleUniversityMailbox(source.oauth.profile, user.email);
        if (email) googleMailboxEvidence.set(context.context, email);
      },
    },

    hooks: {
      before: createAuthMiddleware(async ctx => {
        // Require our own origin even for a fresh login without a session cookie.
        if (ctx.request?.method === 'POST' && ctx.request.headers.get('origin') !== origin) {
          throw new APIError('FORBIDDEN', { code: 'INVALID_ORIGIN', message: 'Request origin is not allowed.' });
        }
        if (ctx.path !== '/email-otp/verify-email') return;
        const email = typeof ctx.body?.email === 'string' ? ctx.body.email.toLowerCase() : '';
        const identity = await ctx.context.internalAdapter.findUserByEmail(email);
        if (!identity || identity.user.emailVerified) return;
        const credential = await ctx.context.internalAdapter.findCredentialAccount(identity.user.id);
        if (!credential?.password) return;
        // An email code must not activate a password registered earlier by someone else.
        // Require the signup/sign-in password too; email-code sign-in instead uses the
        // library's native cleanup of every unproven credential and standing session.
        const password = ctx.body?.password;
        if (typeof password !== 'string' || password.length > 128 ||
            !await ctx.context.password.verify({ password, hash: credential.password })) {
          throw new APIError('UNAUTHORIZED', {
            code: 'INVALID_EMAIL_OR_PASSWORD',
            message: 'Verify with your password, or reset it using your email.',
          });
        }
      }),
      after: createAuthMiddleware(async ctx => {
        if (!onUniversityEmailVerified) return;
        const googleEmail = googleMailboxEvidence.get(ctx.context);
        googleMailboxEvidence.delete(ctx.context);
        const session = ctx.context.newSession;
        const email = dypiuMailbox(session?.user.email);
        if (session?.user.emailVerified && email) {
          const provedByCode = ['/sign-in/email-otp', '/email-otp/verify-email'].includes(ctx.path)
            && dypiuMailbox(ctx.body?.email) === email;
          if (provedByCode || googleEmail === email) {
            await onUniversityEmailVerified({ userId: session.user.id, email, method: provedByCode ? 'email_code' : 'google_workspace' });
          }
        }
        // A completed reset also consumes a mailbox OTP, but creates no session.
        // Failed requests and mere send/check-code requests never reach this branch.
        const returned = ctx.context.returned;
        if (ctx.path === '/email-otp/reset-password' && returned && typeof returned === 'object' && 'success' in returned && returned.success === true) {
          const address = dypiuMailbox(ctx.body?.email);
          if (!address) return;
          const identity = await ctx.context.internalAdapter.findUserByEmail(address);
          if (identity?.user.emailVerified && dypiuMailbox(identity.user.email) === address) {
            await onUniversityEmailVerified({ userId: identity.user.id, email: address, method: 'email_code' });
          }
        }
      }),
    },

    account: {
      // Matching email addresses never authorize merging different login identities.
      accountLinking: { enabled: false, disableImplicitLinking: true, allowDifferentEmails: false },
      encryptOAuthTokens: true,
      storeStateStrategy: 'database',
      skipStateCookieCheck: false,
    },
    emailAndPassword: {
      enabled: emailEnabled,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: emailEnabled,
      sendOnSignIn: emailEnabled,
      autoSignInAfterVerification: true,
    },
    socialProviders: google ? {
      google: { ...google, prompt: 'select_account', includeGrantedScopes: false },
    } : {},
    rateLimit: {
      enabled: true, storage: 'database', window: 60, max: 30,
      customRules: {
        '/sign-up/email': { window: 60, max: 3 },
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-in/social': { window: 60, max: 5 },
        '/email-otp/send-verification-otp': { window: 60, max: 3 },
        '/sign-in/email-otp': { window: 60, max: 5 },
        '/email-otp/request-password-reset': { window: 60, max: 3 },
        '/email-otp/reset-password': { window: 60, max: 5 },
        '/email-otp/verify-email': { window: 60, max: 5 },
      },
    },
    plugins: emailEnabled ? [emailOTP({
      otpLength: 6, expiresIn: 300, allowedAttempts: 3, storeOTP: 'hashed',
      overrideDefaultEmailVerification: true,
      sendVerificationOnSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        if (type === 'change-email') throw new Error('Email changes are not enabled.');
        await sendCode(email, otp, type);
      },
    })] : [],
  });
}
