import 'server-only';
import { authCapabilitiesFor, originIssue } from '../environment';
export const demoEnabled = () => process.env.UNICIRQ_DEMO_MODE === 'true' && process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
export const authenticationCapabilities = () => {
  const methods = authCapabilitiesFor(process.env);
  return demoEnabled() ? { ...methods, email: false, google: false } : methods;
};
export const authConfigured = () => {
  const methods = authenticationCapabilities();
  return methods.base && (methods.email || methods.google);
};
export const emailConfigured = () => authenticationCapabilities().email;
export const googleConfigured = () => authenticationCapabilities().google;
export function appOrigin() {
  const value = process.env.APP_URL;
  if (!value || originIssue(value, process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL)))
    throw new Error('APP_URL must be configured as the exact site origin.');
  return new URL(value).origin;
}
