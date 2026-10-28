import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('actual billing webhook reconciles signed provider events through the restricted SQL gateway', { timeout: 120_000 }, () => {
  // server-only imports are permitted solely in this isolated server-condition
  // process. Its connection pool and provider transport are disposable mocks.
  const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--test', 'tests/fixtures/billing-webhook.ts'], { encoding: 'utf8', timeout: 110_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tests 3/);
});
