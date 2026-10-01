import 'server-only';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { defineAuth } from '../auth-definition';
import { sendSignInCode } from '../email';
import { authPrisma } from './prisma';
import { appOrigin, authConfigured } from './config';

function buildAuth() {
  if (!authConfigured()) {
    throw new Error('Database, auth secret and email provider must be configured.');
  }
  if (process.env.BETTER_AUTH_SECRET!.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 random characters.');
  }
  return defineAuth({
    origin: appOrigin(),
    secret: process.env.BETTER_AUTH_SECRET!,
    database: prismaAdapter(authPrisma(), { provider: 'postgresql' }),
    async sendCode(email, otp) {
      await sendSignInCode({ email, otp }, {
        apiKey: process.env.RESEND_API_KEY!,
        from: process.env.EMAIL_FROM!,
      });
    },
  });
}

let instance: ReturnType<typeof buildAuth> | undefined;
export const getAuth = () => instance ??= buildAuth();
