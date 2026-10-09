export type Environment = Record<string, string | undefined>;
export type ConfigurationCheck = { name: string; status: 'ready' | 'missing' | 'invalid'; message: string };
type InspectionOptions = { hosted?: boolean };
export const isLoopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname.toLowerCase());

// Diagnostics contain names and fixed explanations, never secrets.
export function postgresUrlIssue(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || url.hash)
      return 'Use a PostgreSQL connection URL, including the database name.';
    if (['host', 'hostaddr', 'user', 'password', 'port'].some(key => url.searchParams.has(key)))
      return 'Put connection credentials and host in the URL authority, without query overrides.';
    if ([...url.searchParams.keys()].some((key, index, keys) => keys.indexOf(key) !== index))
      return 'Remove duplicate connection parameters.';
    if (!isLoopback(url.hostname) && url.searchParams.get('sslmode') !== 'verify-full')
      return 'Remote PostgreSQL connections require sslmode=verify-full.';
    if (url.searchParams.get('ssl') === 'false' || url.searchParams.get('ssl') === '0' ||
        url.searchParams.get('sslrejectunauthorized') === 'false')
      return 'Do not disable TLS or certificate validation.';
    if (!isLoopback(url.hostname) && (!url.username || !url.password))
      return 'Use the restricted database login and its password.';
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch { return 'Use a valid PostgreSQL connection URL.'; }
}
export function originIssue(value: string, hosted: boolean): string | undefined {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || url.pathname !== '/') return 'APP_URL must be the exact site origin, without a path or credentials.';
    if (url.protocol !== 'https:' && (hosted || !isLoopback(url.hostname)))
      return 'Use HTTPS for hosted sign-in; HTTP is allowed only for local development.';
    if (hosted && isLoopback(url.hostname)) return 'Use the deployed site origin for hosted sign-in.';
  } catch { return 'APP_URL must be a valid site origin.'; }
}
export const validEmail = (value: string) => value.length <= 254 && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
export function senderAddress(value: string): string | undefined {
  if (/[\r\n]/.test(value)) return;
  const match = value.match(/^[^<>]+<([^<>]+)>$/);
  const address = (match ? match[1] : value).trim();
  return validEmail(address) ? address : undefined;
}
function inspect(env: Environment, validators: Record<string, (value: string) => string | undefined>) {
  return Object.entries(validators).map(([name, validate]): ConfigurationCheck => {
    const value = env[name];
    const issue = value?.trim() ? validate(value) : undefined;
    return { name, status: !value?.trim() ? 'missing' : issue ? 'invalid' : 'ready',
      message: !value?.trim() ? 'Set ' + name + ' in the private environment file.' : issue ?? 'Format checked; live connectivity is checked separately.' };
  });
}
const result = (checks: ConfigurationCheck[]) => ({ ok: checks.every(check => check.status === 'ready'), checks });
const hostedEnvironment = (env: Environment, options: InspectionOptions) => options.hosted ?? (env.NODE_ENV === 'production' || Boolean(env.VERCEL));

export function inspectCoreAuthEnvironment(env: Environment, options: InspectionOptions = {}) {
  const checks = inspect(env, {
    APP_URL: value => originIssue(value, hostedEnvironment(env, options)),
    DATABASE_URL: postgresUrlIssue,
    BETTER_AUTH_SECRET: value => value.length >= 32 && value.trim() === value ? undefined : 'Use a cryptographically random secret of at least 32 characters, without surrounding whitespace.',
  });
  for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'BETTER_AUTH_SECRET', 'RESEND_API_KEY', 'GOOGLE_CLIENT_SECRET']) {
    const publicName = 'NEXT_PUBLIC_' + name;
    if (env[publicName]) checks.push({ name: publicName, status: 'invalid', message: 'Remove this public secret and rotate it if it has been deployed.' });
  }
  if (env.VERCEL && env.MIGRATION_DATABASE_URL)
    checks.push({ name: 'MIGRATION_DATABASE_URL', status: 'invalid', message: 'Remove owner credentials from the hosted runtime.' });
  return result(checks);
}
export function inspectEmailEnvironment(env: Environment, options: InspectionOptions = {}) {
  return result(inspect(env, {
    RESEND_API_KEY: value => /^re_[A-Za-z0-9_-]+$/.test(value) ? undefined : 'Use a valid Resend API key.',
    EMAIL_FROM: value => {
      const address = senderAddress(value);
      if (!address) return 'Use a sender email or Name <email@domain> without line breaks.';
      if (hostedEnvironment(env, options) && address.toLowerCase().endsWith('@resend.dev')) return 'Use your verified sending domain for production email.';
    },
  }));
}
export function inspectGoogleEnvironment(env: Environment) {
  return result(inspect(env, {
    GOOGLE_CLIENT_ID: value => /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value) ? undefined : 'Use the Google Web application OAuth client ID.',
    GOOGLE_CLIENT_SECRET: value => value.length >= 16 && !/\s/.test(value) ? undefined : 'Use the matching private Google OAuth client secret.',
  }));
}
export function authCapabilitiesFor(env: Environment, options: InspectionOptions = {}) {
  const base = inspectCoreAuthEnvironment(env, options).ok;
  return { base, email: base && inspectEmailEnvironment(env, options).ok, google: base && inspectGoogleEnvironment(env).ok };
}
export function inspectRuntimeEnvironment(env: Environment, options: InspectionOptions = {}) {
  const core = inspectCoreAuthEnvironment(env, options);
  const google = inspectGoogleEnvironment(env);
  const includeEmail = !google.ok || Boolean(env.RESEND_API_KEY || env.EMAIL_FROM);
  const checks = [...core.checks, ...(includeEmail ? inspectEmailEnvironment(env, options).checks : [])];
  if (env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET) checks.push(...google.checks);
  return result(checks);
}
