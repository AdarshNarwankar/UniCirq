export interface AccountSecurity {
  demo: boolean; email: string | null; emailVerified: boolean; methods: string[]; canChangePassword: boolean;
  sessions: { id: string; current: boolean; device: string; createdAt: string; expiresAt: string }[];
}
export function deviceLabel(agent: string | null | undefined) {
  if (!agent) return 'Unknown device';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : 'Browser';
  const system = /Android/.test(agent) ? 'Android' : /iPhone|iPad/.test(agent) ? 'iOS' : /Windows/.test(agent) ? 'Windows' : /Macintosh/.test(agent) ? 'macOS' : /Linux/.test(agent) ? 'Linux' : 'device';
  return `${browser} on ${system}`;
}
export function securitySummary({ userId, currentSessionId, email, emailVerified, emailEnabled, accounts, sessions, now = Date.now() }: {
  userId: string; currentSessionId: string; email: string; emailVerified: boolean; emailEnabled: boolean;
  accounts: { userId: string; providerId: string; password: string | null }[];
  sessions: { id: string; userId: string; userAgent: string | null; createdAt: Date; expiresAt: Date }[]; now?: number;
}): AccountSecurity {
  const owned = accounts.filter(account => account.userId === userId);
  const password = owned.some(account => account.providerId === 'credential' && Boolean(account.password));
  return { demo: false, email, emailVerified, canChangePassword: emailEnabled && password, methods: [...new Set(owned.map(account => account.providerId === 'google' ? 'Google' : account.providerId === 'credential' && account.password ? 'Email & password' : 'Email code'))],
    sessions: sessions.filter(session => session.userId === userId && session.expiresAt.getTime() > now).map(session => ({ id: session.id, current: session.id === currentSessionId, device: deviceLabel(session.userAgent), createdAt: session.createdAt.toISOString(), expiresAt: session.expiresAt.toISOString() })) };
}
