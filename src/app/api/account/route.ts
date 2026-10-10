import { requireApiUser } from '@/lib/server/auth';
import { authPrisma } from '@/lib/server/prisma';
import { getAuth } from '@/lib/server/better-auth';
import { authenticationCapabilities, demoEnabled } from '@/lib/server/config';
import { failure, json } from '@/lib/server/http';
import { securitySummary, type AccountSecurity } from '@/lib/account-security';
import { AppError } from '@/lib/policy';

export async function GET(request: Request) {
  try {
    const actor = await requireApiUser();
    if (demoEnabled()) return json({ demo: true, email: null, emailVerified: false, methods: ['Local demo'], canChangePassword: false, sessions: [] } satisfies AccountSecurity);
    const session = await getAuth().api.getSession({ headers: request.headers });
    if (!session || session.user.id !== actor.id) throw new AppError('Sign in to continue', 401);
    const db = authPrisma();
    const [accounts, sessions] = await Promise.all([
      db.account.findMany({ where: { userId: actor.id }, select: { userId: true, providerId: true, password: true } }),
      db.session.findMany({ where: { userId: actor.id, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, userId: true, userAgent: true, createdAt: true, expiresAt: true } }),
    ]);
    return json(securitySummary({ userId: actor.id, currentSessionId: session.session.id, email: session.user.email, emailVerified: session.user.emailVerified, emailEnabled: authenticationCapabilities().email, accounts, sessions }));
  } catch (error) { return failure(error); }
}
