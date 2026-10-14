import { inspectRuntimeEnvironment, authCapabilitiesFor } from '../src/lib/environment';
const arguments_ = process.argv.slice(2);
if (arguments_.some(argument => !['--production', '--json'].includes(argument))) {
  console.error('Usage: npm run setup:check -- [--production] [--json]');
  process.exitCode = 1;
} else {
  const options = { hosted: arguments_.includes('--production') || process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL) };
  const report = inspectRuntimeEnvironment(process.env, options);
  const methods = authCapabilitiesFor(process.env, options);
  const demo = process.env.UNICIRQ_DEMO_MODE === 'true';
  const warnings = demo ? ['UNICIRQ_DEMO_MODE is enabled. Set it to false before testing database-backed sign-in. Hosted demo access is always disabled.'] : [];
  if (!methods.google) warnings.push('Google sign-in is unavailable until both Google Web OAuth credentials and core database/auth settings are valid.');
  if (!methods.email) warnings.push('Email/password, email-code sign-in and recovery are unavailable until the database and selected email sender are configured.');
  if (process.env.EMAIL_PROVIDER === 'gmail') warnings.push('Gmail SMTP is selected for temporary testing. Gmail sending limits and account protections apply; use a dedicated transactional sender for public launch.');
  const ready = report.ok && !demo && (methods.email || methods.google);
  if (arguments_.includes('--json')) console.log(JSON.stringify({ ready, methods, checks: report.checks, warnings }, null, 2));
  else {
    console.log('UniCirq private configuration check (no values are printed)');
    for (const check of report.checks) console.log(check.status.toUpperCase() + ' ' + check.name + ': ' + check.message);
    for (const warning of warnings) console.log('ACTION: ' + warning);
    console.log(ready ? 'Configuration formats pass. Next run db:check, then test each enabled sign-in method.' : 'Live sign-in setup is incomplete. The local demo can still be used.');
  }
  if (!ready) process.exitCode = 1;
}
