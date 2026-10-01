import 'server-only';
import { inspectRuntimeEnvironment, originIssue } from '../environment';
export const demoEnabled = () => process.env.UNICIRQ_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
export const authConfigured = () => inspectRuntimeEnvironment(process.env).ok;
export function appOrigin() {
  const value = process.env.APP_URL;
  if (!value || originIssue(value, process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)))
    throw new Error('APP_URL must be configured as the exact site origin.');
  return new URL(value).origin;
}
