import 'server-only';
export const demoEnabled = () => process.env.UNICIRQ_DEMO_MODE==='true' && process.env.NODE_ENV!=='production' && !process.env.VERCEL;
export const authConfigured = () => Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET && process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
export function appOrigin(){const value=process.env.APP_URL;if(!value)throw new Error('APP_URL must be configured');return new URL(value).origin}
