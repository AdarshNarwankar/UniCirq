import 'server-only';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { defineAuth } from '../auth-definition';
import { sendSignInCode, type EmailConfiguration } from '../email';
import { authPrisma } from './prisma';
import { appOrigin, authenticationCapabilities } from './config';

function buildAuth() {
  const capabilities = authenticationCapabilities();
  if (!capabilities.base || (!capabilities.email && !capabilities.google)) {
    throw new Error('Configure the database, auth secret and at least one sign-in provider.');
  }
  return defineAuth({
    origin: appOrigin(),
    secret: process.env.BETTER_AUTH_SECRET!,
    database: prismaAdapter(authPrisma(), { provider: 'postgresql', transaction: true }),
    emailEnabled: capabilities.email,
    ...(capabilities.google ? {
      google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET! },
    } : {}),
    async onUniversityEmailVerified({ userId, email }) {
      // This private auth column is deliberately absent from Better Auth's
      // additionalFields, request schemas, public session output and snapshots.
      // The database trigger independently enforces campus, role and review rules.
      await authPrisma().user.updateMany({
        where: { id: userId, email: { equals: email, mode: 'insensitive' }, emailVerified: true },
        data: { campusEmailProof: email },
      });
    },
    async sendCode(email, otp, type) {
      if (!capabilities.email) throw new Error('Email authentication is not configured.');
      const configuration: EmailConfiguration = process.env.EMAIL_PROVIDER === 'gmail' ? {
        transport: 'gmail',
        user: process.env.GMAIL_USER!,
        appPassword: process.env.GMAIL_APP_PASSWORD!,
        from: process.env.EMAIL_FROM!,
      } : {
        apiKey: process.env.RESEND_API_KEY!,
        from: process.env.EMAIL_FROM!,
      };
      await sendSignInCode({ email, otp, type }, configuration);
    },
  });
}

let instance: ReturnType<typeof buildAuth> | undefined;
export const getAuth = () => instance ??= buildAuth();
