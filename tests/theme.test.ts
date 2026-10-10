import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { parseTheme, resolveTheme, themeInitScript, themeKey } from '../src/lib/theme';

test('appearance preferences only allow light, dark or system', () => {
  for (const input of [null, undefined, '', 'unexpected', {}, 'System']) assert.equal(parseTheme(input), 'system');
  assert.equal(parseTheme('light'), 'light'); assert.equal(parseTheme('dark'), 'dark');
  assert.equal(resolveTheme('system', true), 'dark'); assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light'); assert.equal(resolveTheme('dark', false), 'dark');
});
test('first-paint script agrees with provider rules and tolerates unavailable storage', () => {
  for (const saved of [null, 'light', 'dark', 'invalid']) for (const systemDark of [true, false]) {
    const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
    runInNewContext(themeInitScript, { document: { documentElement: root }, localStorage: { getItem(key: string) { assert.equal(key, themeKey); return saved; } }, window: { matchMedia: () => ({ matches: systemDark }) } });
    assert.equal(root.dataset.theme, resolveTheme(parseTheme(saved), systemDark)); assert.equal(root.style.colorScheme, root.dataset.theme);
  }
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  runInNewContext(themeInitScript, { document: { documentElement: root }, localStorage: { getItem() { throw new Error('blocked'); } }, window: { matchMedia: () => ({ matches: true }) } });
  assert.equal(root.dataset.theme, 'dark');
});
