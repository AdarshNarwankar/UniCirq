import { getAuth } from '@/lib/server/better-auth';
import { authConfigured, demoEnabled, authenticationCapabilities } from '@/lib/server/config';
import { json } from '@/lib/server/http';

async function handler(request: Request) {
  if (!authConfigured() || demoEnabled()) return json({ code: 'AUTH_UNAVAILABLE', error: 'Sign-in is being prepared. Please try again later.' }, 503);
  const path = new URL(request.url).pathname.replace('/api/auth', '');
  const methods = authenticationCapabilities();
  if ((path.startsWith('/email-otp/') || ['/sign-in/email', '/sign-up/email', '/request-password-reset', '/reset-password', '/send-verification-email'].includes(path)) && !methods.email)
    return json({ code: 'AUTH_METHOD_UNAVAILABLE', error: 'Email sign-in is currently unavailable. Please use Google.' }, 503);
  if (path === '/callback/google' && !methods.google)
    return json({ code: 'AUTH_METHOD_UNAVAILABLE', error: 'Google sign-in is currently unavailable.' }, 503);
  try {
    const response = await getAuth().handler(request);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch {
    console.error('UniCirq sign-in service is temporarily unavailable.');
    return json({ code: 'AUTH_UNAVAILABLE', error: 'Sign-in is temporarily unavailable. Please try again.' }, 503);
  }
}
export { handler as GET, handler as POST };
