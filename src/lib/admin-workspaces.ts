export const adminPaths = {
  overview: '/admin', catalogue: '/admin/moderation', queue: '/admin/moderation-queue',
  safety: '/admin/trust-safety', support: '/admin/support', help: '/admin/support-center',
  verifications: '/admin/verifications', analytics: '/admin/analytics', audit: '/admin/audit',
  profile: '/admin/profile', settings: '/admin/settings', notifications: '/admin/notifications', billing: '/admin/billing',
} as const;
const pages = new Set<string>(Object.values(adminPaths).map(path => path.slice('/admin'.length).replace(/^\//, '')));
export function isAdminPage(path: string[]) { return path.length <= 1 && pages.has(path[0] ?? ''); }
const accountPages = new Set<string>([adminPaths.profile, adminPaths.settings, adminPaths.notifications, adminPaths.billing]);
export const adminSearchPages: readonly string[] = Object.values(adminPaths).filter(path => !accountPages.has(path));
export const adminRecordPages: readonly string[] = adminSearchPages.filter(path => path !== adminPaths.help);
export const adminCaseHref = (id: string, type?: string) => `${adminPaths.support}?ticket=${encodeURIComponent(id)}${type ? `&type=${encodeURIComponent(type)}` : ''}`;
export const adminTime = (date: string) => new Date(date).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
