import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceLabel, securitySummary } from '../src/lib/account-security';

test('account summary exposes only owned active session metadata and no credentials', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const session = { id: 'session-id', userId: 'owner', userAgent: 'Windows Chrome/100.0', createdAt: new Date(now - 1000), expiresAt: new Date(now + 1000), token: 'sensitive-token', ipAddress: 'private-ip' };
  const result = securitySummary({ userId: 'owner', currentSessionId: session.id, email: 'test@example.test', emailVerified: true, emailEnabled: true, now,
    accounts: [{ userId: 'owner', providerId: 'credential', password: 'password-hash' }, { userId: 'intruder', providerId: 'google', password: null }],
    sessions: [session, { ...session, id: 'foreign', userId: 'intruder' }, { ...session, id: 'expired', expiresAt: new Date(now) }] });
  assert.equal(result.canChangePassword, true); assert.deepEqual(result.methods, ['Email & password']); assert.equal(result.sessions.length, 1); assert.equal(result.sessions[0].current, true);
  for (const secret of ['sensitive-token', 'password-hash', 'private-ip', 'intruder', 'expired']) assert.equal(JSON.stringify(result).includes(secret), false);
});
test('Google and code accounts cannot display a working password-change control', () => {
  const input = { userId: 'owner', currentSessionId: 'session', email: 'test@example.test', emailVerified: true, emailEnabled: true, sessions: [] };
  assert.equal(securitySummary({ ...input, accounts: [{ userId: 'owner', providerId: 'google', password: null }] }).canChangePassword, false);
  assert.equal(securitySummary({ ...input, accounts: [] }).canChangePassword, false);
  assert.equal(securitySummary({ ...input, emailEnabled: false, accounts: [{ userId: 'owner', providerId: 'credential', password: 'hash' }] }).canChangePassword, false);
  assert.equal(deviceLabel('Android Chrome/100 Edg/100'), 'Edge on Android'); assert.equal(deviceLabel(null), 'Unknown device');
});
