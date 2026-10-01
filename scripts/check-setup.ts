import { inspectRuntimeEnvironment } from '../src/lib/environment';

const arguments_ = process.argv.slice(2);
if (arguments_.some(argument => !['--production', '--json'].includes(argument))) {
  console.error('Usage: npm run setup:check -- [--production] [--json]');
  process.exitCode = 1;
} else {
  const report = inspectRuntimeEnvironment(process.env, { hosted: arguments_.includes('--production') || process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL) });
  const demo = process.env.UNICIRQ_DEMO_MODE === 'true';
  const warnings = demo ? ['UNICIRQ_DEMO_MODE is enabled. Set it to false before testing database-backed sign-in. Hosted demo access is always disabled.'] : [];
  const ready = report.ok && !demo;
  if (arguments_.includes('--json')) console.log(JSON.stringify({ ready, checks: report.checks, warnings }, null, 2));
  else {
    console.log('UniCirq private configuration check (no values are printed)');
    for (const check of report.checks) console.log(`${check.status.toUpperCase()} ${check.name}: ${check.message}`);
    for (const warning of warnings) console.log(`ACTION: ${warning}`);
    console.log(ready ? 'Configuration formats pass. Next run db:check, then test sign-in.' : 'Live sign-in setup is incomplete. The local demo can still be used.');
  }
  if (!ready) process.exitCode = 1;
}
