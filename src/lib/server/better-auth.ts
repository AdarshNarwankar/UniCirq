import 'server-only';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { defineAuth } from '../auth-definition';
import { sendSignInCode } from '../email';
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
    async sendCode(email, otp, type) {
      if (!capabilities.email) throw new Error('Email authentication is not configured.');
      await sendSignInCode({ email, otp, type }, {
        apiKey: process.env.RESEND_API_KEY!,
        from: process.env.EMAIL_FROM!,
      });
    },
  });
}

let instance: ReturnType<typeof buildAuth> | undefined;
export const getAuth = () => instance ??= buildAuth();
