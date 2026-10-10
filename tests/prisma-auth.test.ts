import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite, type ParserOptions } from '@electric-sql/pglite';
import { Pool, types } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '../src/generated/prisma/client';
import { defineAuth } from '../src/lib/auth-definition';

// Exercise the production Prisma adapter against PostgreSQL in-process.
// Only the transport is replaced: Prisma still generates and executes its SQL.
const db = new PGlite();
type PgRequest = {
  text: string;
  values?: unknown[];
  rowMode?: 'array';
  types?: { getTypeParser(oid: number, format: 'text'): (value: string) => unknown };
};
class PGlitePool extends Pool {
  override query = (async (input: string | PgRequest, values: unknown[] = []) => {
    const request = typeof input === 'string' ? { text: input, values } : input;
    const parsers: ParserOptions = {};
    if (request.types) {
      for (const oid of Object.values(types.builtins)) {
        parsers[oid] = request.types.getTypeParser(oid, 'text');
      }
    }
    const result = await db.query(request.text, request.values ?? [], {
      rowMode: request.rowMode,
      ...(request.types ? { parsers } : {}),
    });
    return {
      rows: result.rows,
      fields: result.fields,
      rowCount: result.affectedRows ?? result.rows.length,
      command: request.text.trim().split(/\s+/)[0].toUpperCase(),
    };
  }) as Pool['query'];

  override connect = (async () => Object.assign(new EventEmitter(), {
    query: this.query,
    release() {},
  })) as unknown as Pool['connect'];
}

const prisma = new PrismaClient({ adapter: new PrismaPg(new PGlitePool()), log: [] });
const origin = 'http://127.0.0.1:3901';
let code = '';
let requestIp = '127.0.0.1';
const collectedCodes = new Map<string, string>();
let cookie = '';
const auth = defineAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
  origin,
  secret: 'test-only-prisma-auth-secret-with-at-least-thirty-two-characters',
  sendCode: async (email, otp, type = 'sign-in') => { code = otp; collectedCodes.set(email + ':' + type, otp); },
  google: { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-only-google-client-secret' },
});

async function request(path: string, data?: object, originHeader = origin) {
  return auth.handler(new Request(origin + '/api/auth' + path, {
    method: data ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      origin: originHeader,
      'x-forwarded-for': requestIp,
      ...(cookie ? { cookie } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  }));
}

before(async () => {
  for (const file of (await readdir('database/migrations')).sort()) {
    await db.exec(await readFile('database/migrations/' + file, 'utf8'));
  }
  await db.exec(`
    CREATE ROLE prisma_test_runtime NOLOGIN;
    GRANT unicirq_app TO prisma_test_runtime;
    GRANT USAGE ON SCHEMA public TO prisma_test_runtime;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON "user", "session", account, verification, "rateLimit" TO prisma_test_runtime;
    SET ROLE prisma_test_runtime;
  `);
});
after(async () => { await prisma.$disconnect(); await db.close(); });

test('account security actions validate password ownership and revoke only owned sessions', async (t) => {
  cookie = ''; requestIp = '127.0.0.31';
  const email = 'settings-owner@example.test', password = 'Settings-password-123';
  const signup = await request('/sign-up/email', { name: 'Settings owner', email, password });
  assert.equal(signup.status, 200);
  const verified = await request('/email-otp/verify-email', { email, password, otp: collectedCodes.get(email + ':email-verification') });
  assert.equal(verified.status, 200); absorbCookies(verified);
  const current = await (await request('/get-session')).json();
  const other = await prisma.session.create({ data: { id: crypto.randomUUID(), userId: current.user.id, token: 'test-only-second-device', expiresAt: new Date(Date.now() + 60000) } });
  const outsider = await prisma.user.create({ data: { id: crypto.randomUUID(), name: 'Other settings owner', email: 'settings-outsider@example.test', emailVerified: true } });
  const foreign = await prisma.session.create({ data: { id: crypto.randomUUID(), userId: outsider.id, token: 'test-only-foreign-device', expiresAt: new Date(Date.now() + 60000) } });
  await t.test('list and revoke actions cannot operate on another user’s session', async () => {
    const sessions = await (await request('/list-sessions')).json();
    assert.equal(sessions.length, 2); assert.ok(sessions.every((value: { userId: string }) => value.userId === current.user.id));
    assert.equal((await request('/revoke-session', { token: foreign.token })).status, 200);
    assert.equal(await prisma.session.count({ where: { id: foreign.id } }), 1);
  });
  await t.test('invalid password and cross-origin mutations leave every session intact', async () => {
    const invalid = await request('/change-password', { currentPassword: 'wrong-password-123', newPassword: 'Replacement-password-456', revokeOtherSessions: true });
    assert.equal(invalid.status, 400);
    const crossOrigin = await request('/revoke-other-sessions', {}, 'https://attacker.example');
    assert.equal(crossOrigin.status, 403);
    assert.equal(await prisma.session.count({ where: { userId: current.user.id } }), 2);
  });
  await t.test('correct password change rotates the cookie and removes older devices', async () => {
    const changed = await request('/change-password', { currentPassword: password, newPassword: 'Replacement-password-456', revokeOtherSessions: true });
    assert.equal(changed.status, 200); absorbCookies(changed);
    assert.equal(await prisma.session.count({ where: { id: other.id } }), 0);
    assert.equal(await prisma.session.count({ where: { id: current.session.id } }), 0);
    assert.equal(await prisma.session.count({ where: { userId: current.user.id } }), 1);
    assert.equal(await prisma.session.count({ where: { id: foreign.id } }), 1);
    const renewed = await (await request('/get-session')).json(); assert.equal(renewed.user.id, current.user.id);
    const old = await request('/sign-in/email', { email, password }); assert.equal(old.status, 401);
    const valid = await request('/sign-in/email', { email, password: 'Replacement-password-456' }); assert.equal(valid.status, 200); absorbCookies(valid);
  });
  await t.test('sign out other sessions keeps the current session and foreign accounts', async () => {
    const response = await request('/revoke-other-sessions', {}); assert.equal(response.status, 200);
    assert.equal(await prisma.session.count({ where: { userId: current.user.id } }), 1);
    assert.equal(await prisma.session.count({ where: { id: foreign.id } }), 1);
    assert.equal((await (await request('/get-session')).json()).user.id, current.user.id);
  });
  await request('/sign-out', {}); cookie = ''; requestIp = '127.0.0.1';
});

test('Prisma-backed email authentication preserves the restricted PostgreSQL workflow', async (t) => {
  let userId = '';
  await t.test('OTP is persisted as a hash using the SQL schema', async () => {
    const response = await request('/email-otp/send-verification-otp', {
      email: 'prisma-student@example.test', type: 'sign-in',
    });
    assert.equal(response.status, 200, await response.text());
    assert.match(code, /^\d{6}$/);
    const rows = await prisma.verification.findMany();
    assert.ok(rows.length > 0);
    assert.ok(rows.every(row => !row.value.includes(code)));
  });
  await t.test('verified OTP creates a session and an unverified student profile', async () => {
    const response = await request('/sign-in/email-otp', {
      email: 'prisma-student@example.test', otp: code,
      name: 'Prisma Test Student', role: 'admin', verified: true,
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.user.emailVerified, true);
    userId = body.user.id;
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.some(value => /HttpOnly/i.test(value)));
    cookie = cookies.map(value => value.split(';')[0]).join('; ');

    await db.exec('SET ROLE unicirq_app');
    await db.query("SELECT set_config('app.user_id', $1, false)", [userId]);
    const profile = await db.query<{ role: string; verified: boolean }>(
      'SELECT role, verified FROM profiles WHERE id = $1', [userId],
    );
    assert.equal(profile.rows[0].role, 'student');
    assert.equal(profile.rows[0].verified, false);
    await db.exec('RESET ROLE; SET ROLE prisma_test_runtime');
  });
  await t.test('real sessions resolve and forged sessions fail', async () => {
    const response = await request('/get-session');
    const body = await response.json();
    assert.equal(body.user.id, userId);
    const savedCookie = cookie;
    cookie = 'better-auth.session_token=forged';
    assert.equal(await (await request('/get-session')).json(), null);
    cookie = savedCookie;
  });
  await t.test('OTP replay and an attacker origin are rejected', async () => {
    const replay = await request('/sign-in/email-otp', {
      email: 'prisma-student@example.test', otp: code,
    });
    assert.ok(replay.status >= 400);
    const crossOrigin = await request('/email-otp/send-verification-otp', {
      email: 'another-prisma-student@example.test', type: 'sign-in',
    }, 'https://attacker.example');
    assert.equal(crossOrigin.status, 403);
  });
  await t.test('database rate limits work with the bigint column', async () => {
    const records = await prisma.rateLimit.findMany();
    assert.ok(records.length > 0);
    assert.ok(records.every(row => typeof row.lastRequest === 'bigint'));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request('/email-otp/send-verification-otp', {
        email: 'limited-prisma-student@example.test', type: 'sign-in',
      });
      if (attempt === 3) assert.equal(response.status, 429);
    }
  });
  await t.test('sign out revokes the persisted session', async () => {
    const response = await request('/sign-out', {});
    assert.equal(response.status, 200);
    assert.equal(await (await request('/get-session')).json(), null);
    assert.equal(await prisma.session.count({ where: { userId } }), 0);
  });
});


function absorbCookies(response: Response) {
  const jar = new Map(cookie.split('; ').filter(Boolean).map(value => {
    const separator = value.indexOf('=');
    return [value.slice(0, separator), value.slice(separator + 1)];
  }));
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(';')[0];
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator);
    const content = pair.slice(separator + 1);
    if (!content || /Max-Age=0/i.test(value)) jar.delete(name);
    else jar.set(name, content);
  }
  cookie = [...jar].map(([name, value]) => name + '=' + value).join('; ');
}

test('password signup, verification, sign-in and OTP reset use the Prisma authentication tables', async (t) => {
  cookie = '';
  requestIp = '127.0.0.2';
  const email = 'password-student@example.test';
  const password = 'Test-only-password-123';
  let userId = '';
  await t.test('short and oversized passwords cannot create accounts', async () => {
    for (const invalid of ['short', 'x'.repeat(129)]) {
      const response = await request('/sign-up/email', { name: 'Test', email, password: invalid });
      assert.equal(response.status, 400);
    }
    assert.equal(await prisma.user.count({ where: { email } }), 0);
  });
  await t.test('signup hashes the password and sends a verification OTP without a session', async () => {
    const response = await request('/sign-up/email', {
      name: 'Password Student', email, password, callbackURL: '/auth/complete',
      role: 'admin', emailVerified: true,
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.token, null);
    assert.equal(body.user.emailVerified, false);
    userId = body.user.id;
    assert.equal(await prisma.session.count({ where: { userId } }), 0);
    const account = await prisma.account.findFirst({ where: { userId, providerId: 'credential' } });
    assert.ok(account?.password);
    assert.notEqual(account.password, password);
    assert.ok(!account.password.includes(password));
    const verificationCode = collectedCodes.get(email + ':email-verification');
    assert.match(verificationCode ?? '', /^\d{6}$/);
    const stored = await prisma.verification.findMany({ where: { identifier: { contains: email } } });
    assert.ok(stored.length);
    assert.ok(stored.every(record => !record.value.includes(verificationCode!)));
  });
  await t.test('password sign-in is blocked until verification, which establishes a session', async () => {
    const blocked = await request('/sign-in/email', { email, password });
    const blockedBody = await blocked.json();
    assert.equal(blocked.status, 403, JSON.stringify(blockedBody));
    assert.equal(blockedBody.code, 'EMAIL_NOT_VERIFIED');
    const response = await request('/email-otp/verify-email', {
      email, password, otp: collectedCodes.get(email + ':email-verification'),
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.user.emailVerified, true);
    assert.ok(body.token);
    assert.ok(response.headers.getSetCookie().some(value => /HttpOnly/i.test(value)));
    absorbCookies(response);
    const session = await (await request('/get-session')).json();
    assert.equal(session.user.id, userId);
    await db.exec('SET ROLE unicirq_app');
    await db.query("SELECT set_config('app.user_id', $1, false)", [userId]);
    const profile = await db.query<{ role: string; verified: boolean; college_id: string | null }>(
      'SELECT role, verified, college_id FROM profiles WHERE id=$1', [userId],
    );
    assert.equal(profile.rows[0].role, 'student');
    assert.equal(profile.rows[0].verified, false);
    assert.equal(profile.rows[0].college_id, null);
    await db.exec('RESET ROLE; SET ROLE prisma_test_runtime');
  });
  await t.test('incorrect passwords fail while the verified password succeeds', async () => {
    const wrong = await request('/sign-in/email', { email, password: 'wrong-test-password' });
    assert.equal(wrong.status, 401);
    const valid = await request('/sign-in/email', { email, password });
    assert.equal(valid.status, 200, await valid.clone().text());
    absorbCookies(valid);
  });
  await t.test('reset requests do not reveal an unknown account', async () => {
    const known = await request('/email-otp/request-password-reset', { email });
    const unknownEmail = 'unknown-password-student@example.test';
    const unknown = await request('/email-otp/request-password-reset', { email: unknownEmail });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), await known.json());
    assert.equal(collectedCodes.has(unknownEmail + ':forget-password'), false);
  });
  await t.test('OTP reset rejects an invalid password, revokes sessions and cannot be replayed', async () => {
    const otp = collectedCodes.get(email + ':forget-password');
    assert.match(otp ?? '', /^\d{6}$/);
    const badPassword = await request('/email-otp/reset-password', { email, otp, password: 'short' });
    assert.equal(badPassword.status, 400);
    const replacement = 'Another-test-password-456';
    const response = await request('/email-otp/reset-password', { email, otp, password: replacement });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(await prisma.session.count({ where: { userId } }), 0);
    assert.equal(await (await request('/get-session')).json(), null);
    const replay = await request('/email-otp/reset-password', { email, otp, password: replacement });
    assert.ok(replay.status >= 400);
    const oldPassword = await request('/sign-in/email', { email, password });
    assert.equal(oldPassword.status, 401);
    const newPassword = await request('/sign-in/email', { email, password: replacement });
    assert.equal(newPassword.status, 200, await newPassword.clone().text());
    absorbCookies(newPassword);
    await request('/sign-out', {});
    cookie = '';
  });
});

test('Google redirect flow enforces state, PKCE, trusted callbacks and separate account ownership', async (t) => {
  cookie = '';
  requestIp = '127.0.0.3';
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const { createHash } = await import('node:crypto');
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = { ...await exportJWK(publicKey), kid: 'test-google-key', alg: 'RS256', use: 'sig' };
  const realFetch = globalThis.fetch;
  let tokenRequests = 0;
  let googleEmail = 'google-student@example.test';
  let googleSubject = 'google-test-student-subject';
  let challenge = '';
  let nonce: string | null = null;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token') {
      tokenRequests += 1;
      const parameters = new URLSearchParams(String(init?.body));
      assert.equal(parameters.get('grant_type'), 'authorization_code');
      assert.equal(parameters.get('redirect_uri'), origin + '/api/auth/callback/google');
      const verifier = parameters.get('code_verifier');
      assert.ok(verifier);
      assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge);
      const idToken = await new SignJWT({
        sub: googleSubject, email: googleEmail, email_verified: true,
        name: 'Google Student', ...(nonce ? { nonce } : {}),
      }).setProtectedHeader({ alg: 'RS256', kid: 'test-google-key' })
        .setIssuer('https://accounts.google.com').setAudience('test-client.apps.googleusercontent.com')
        .setIssuedAt().setExpirationTime('5m').sign(privateKey);
      return Response.json({
        access_token: 'test-only-google-access-token',
        token_type: 'Bearer', expires_in: 300, id_token: idToken,
      });
    }
    if (url.origin === 'https://www.googleapis.com' && url.pathname === '/oauth2/v3/certs') {
      return Response.json({ keys: [publicJwk] });
    }
    throw new Error('Authentication test rejected an unexpected external request.');
  };
  async function beginGoogle() {
    const response = await request('/sign-in/social', {
      provider: 'google', callbackURL: '/auth/complete', errorCallbackURL: '/login', disableRedirect: true,
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.redirect, false);
    const url = new URL(body.url);
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('redirect_uri'), origin + '/api/auth/callback/google');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('state'));
    assert.ok(url.searchParams.get('code_challenge'));
    assert.deepEqual(new Set(url.searchParams.get('scope')?.split(' ')), new Set(['openid', 'email', 'profile']));
    challenge = url.searchParams.get('code_challenge')!;
    nonce = url.searchParams.get('nonce');
    absorbCookies(response);
    return url.searchParams.get('state')!;
  }
  try {
    await t.test('cross-origin login and external callbacks are rejected before redirect', async () => {
      for (const callback of ['https://attacker.example/callback', '//attacker.example/callback']) {
        const response = await request('/sign-in/social', { provider: 'google', callbackURL: callback });
        assert.equal(response.status, 403);
      }
      // Force validation of the cookie-bearing cross-origin request.
      cookie = 'test-cookie=1';
      const blocked = await request('/sign-in/social', {
        provider: 'google', callbackURL: '/auth/complete',
      }, 'https://attacker.example');
      assert.equal(blocked.status, 403);
      cookie = '';
    });
    await t.test('forged state cannot reach the token endpoint or create a session', async () => {
      const forged = await request('/callback/google?code=test-code&state=forged');
      assert.ok(forged.status >= 300);
      assert.match(forged.headers.get('location') ?? '', /error=/);
      assert.equal(tokenRequests, 0);
      assert.equal(await prisma.user.count({ where: { email: googleEmail } }), 0);
    });
    await t.test('valid OAuth state still requires the matching signed browser cookie', async () => {
      requestIp = '127.0.0.6';
      const state = await beginGoogle();
      const browserCookie = cookie;
      cookie = '';
      const rejected = await request('/callback/google?code=test-code&state=' + encodeURIComponent(state));
      assert.ok(rejected.status >= 300 && rejected.status < 400);
      const location = new URL(rejected.headers.get('location')!, origin);
      assert.equal(location.origin, origin);
      assert.match(location.searchParams.get('error') ?? '', /state_mismatch/);
      assert.equal(tokenRequests, 0);
      cookie = browserCookie;
      await request('/callback/google?error=access_denied&state=' + encodeURIComponent(state));
      cookie = '';
      requestIp = '127.0.0.3';
    });
    await t.test('a forged direct Google ID token cannot authenticate', async () => {
      requestIp = '127.0.0.7';
      const response = await request('/sign-in/social', {
        provider: 'google', idToken: { token: 'forged.invalid.token' },
      });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, 'INVALID_TOKEN');
      assert.equal(tokenRequests, 0);
      requestIp = '127.0.0.3';
    });

    await t.test('a Google error redirects safely and leaves no authenticated session', async () => {
      const state = await beginGoogle();
      const denied = await request('/callback/google?error=access_denied&state=' + encodeURIComponent(state));
      assert.ok(denied.status >= 300 && denied.status < 400);
      const location = new URL(denied.headers.get('location')!, origin);
      assert.equal(location.origin, origin);
      assert.equal(location.pathname, '/login');
      assert.equal(location.searchParams.get('error'), 'access_denied');
      assert.equal(tokenRequests, 0);
      assert.equal(await (await request('/get-session')).json(), null);
      cookie = '';
    });
    await t.test('a valid callback creates a verified identity and an unverified Student profile', async () => {
      const state = await beginGoogle();
      const response = await request('/callback/google?code=test-code&state=' + encodeURIComponent(state));
      assert.ok(response.status >= 300 && response.status < 400, await response.clone().text());
      assert.equal(new URL(response.headers.get('location')!, origin).pathname, '/auth/complete');
      absorbCookies(response);
      const session = await (await request('/get-session')).json();
      assert.equal(session.user.email, googleEmail);
      assert.equal(session.user.emailVerified, true);
      const exchanges = tokenRequests;
      const replay = await request('/callback/google?code=test-code&state=' + encodeURIComponent(state));
      assert.match(replay.headers.get('location') ?? '', /error=state_mismatch/);
      assert.equal(tokenRequests, exchanges);
      const account = await prisma.account.findFirst({ where: { userId: session.user.id, providerId: 'google' } });
      assert.ok(account);
      assert.notEqual(account.accessToken, 'test-only-google-access-token');
      await db.exec('SET ROLE unicirq_app');
      await db.query("SELECT set_config('app.user_id', $1, false)", [session.user.id]);
      const profile = await db.query<{ role: string; verified: boolean }>(
        'SELECT role,verified FROM profiles WHERE id=$1', [session.user.id],
      );
      assert.equal(profile.rows[0].role, 'student');
      assert.equal(profile.rows[0].verified, false);
      await db.exec('RESET ROLE; SET ROLE prisma_test_runtime');
      await request('/sign-out', {});
      cookie = '';
    });
    await t.test('Google cannot silently claim a pre-registered email/password account', async () => {
      requestIp = '127.0.0.4';
      googleEmail = 'pre-registered-student@example.test';
      googleSubject = 'pre-registered-google-subject';
      const registration = await request('/sign-up/email', {
        name: 'Pre-registered Student', email: googleEmail, password: 'Test-only-password-789',
      });
      assert.equal(registration.status, 200);
      const localUser = await prisma.user.findUnique({ where: { email: googleEmail } });
      assert.equal(localUser?.emailVerified, false);
      const state = await beginGoogle();
      const callback = await request('/callback/google?code=test-code&state=' + encodeURIComponent(state));
      const location = new URL(callback.headers.get('location')!, origin);
      assert.equal(location.origin, origin);
      assert.equal(location.pathname, '/login');
      assert.match(location.searchParams.get('error') ?? '', /account_not_linked/);
      assert.equal(await prisma.account.count({ where: { userId: localUser!.id, providerId: 'google' } }), 0);
      assert.equal(await (await request('/get-session')).json(), null);
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Google-only configuration cannot expose email/password or OTP sign-in', async () => {
  cookie = '';
  requestIp = '127.0.0.5';
  const googleOnly = defineAuth({
    database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
    origin, secret: 'test-only-google-secret-with-at-least-thirty-two-characters',
    emailEnabled: false,
    google: { clientId: 'test-client.apps.googleusercontent.com', clientSecret: 'test-only-google-secret' },
    sendCode: async () => { throw new Error('Email provider should not be called.'); },
  });
  for (const path of ['/sign-up/email', '/sign-in/email', '/sign-in/email-otp']) {
    const response = await googleOnly.handler(new Request(origin + '/api/auth' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', origin },
      body: JSON.stringify({ email: 'disabled@example.test', name: 'Disabled', password: 'test-password-123', otp: '123456' }),
    }));
    assert.ok(response.status >= 400, path);
  }
});






test('mailbox proof never activates an earlier unverified password chosen by someone else', async (t) => {
  cookie = '';
  requestIp = '127.0.0.9';
  const email = 'password-ownership@example.test';
  const attackerPassword = 'Attacker-test-password-123';
  const ownerPassword = 'Owner-test-password-456';
  let userId = '';
  await t.test('duplicate signup remains generic without replacing the earlier password', async () => {
    const initial = await request('/sign-up/email', { name: 'Unproven Name', email, password: attackerPassword });
    assert.equal(initial.status, 200);
    const earlier = await prisma.user.findUnique({ where: { email } });
    userId = earlier!.id;
    const duplicate = await request('/sign-up/email', { name: 'Actual Student', email, password: ownerPassword });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).token, null);
    assert.equal(await prisma.user.count({ where: { email } }), 1);
  });
  await t.test('verification rejects missing or mismatched password even with the correct email code', async () => {
    const otp = collectedCodes.get(email + ':email-verification');
    assert.match(otp ?? '', /^\d{6}$/);
    for (const payload of [{ email, otp }, { email, otp, password: ownerPassword }]) {
      const response = await request('/email-otp/verify-email', payload);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).code, 'INVALID_EMAIL_OR_PASSWORD');
    }
    assert.equal((await prisma.user.findUnique({ where: { id: userId } }))?.emailVerified, false);
    assert.equal(await prisma.session.count({ where: { userId } }), 0);
    const attacker = await request('/sign-in/email', { email, password: attackerPassword });
    assert.equal(attacker.status, 403);
  });
  await t.test('email-code sign-in removes every unproven password and existing session', async () => {
    // A pre-verification session should not survive proof by the mailbox owner.
    await prisma.session.create({ data: { id: crypto.randomUUID(), userId, token: 'test-only-unproven-session', expiresAt: new Date(Date.now() + 60000) } });
    const sent = await request('/email-otp/send-verification-otp', { email, type: 'sign-in' });
    assert.equal(sent.status, 200);
    const response = await request('/sign-in/email-otp', { email, otp: collectedCodes.get(email + ':sign-in') });
    assert.equal(response.status, 200, await response.clone().text());
    absorbCookies(response);
    assert.equal((await prisma.user.findUnique({ where: { id: userId } }))?.emailVerified, true);
    assert.equal(await prisma.account.count({ where: { userId, providerId: 'credential' } }), 0);
    assert.equal(await prisma.session.count({ where: { token: 'test-only-unproven-session' } }), 0);
    const rejected = await request('/sign-in/email', { email, password: attackerPassword });
    assert.equal(rejected.status, 401);
    await request('/sign-out', {});
    cookie = '';
  });
  await t.test('mailbox owner can set a new password through recovery', async () => {
    const sent = await request('/email-otp/request-password-reset', { email });
    assert.equal(sent.status, 200);
    const response = await request('/email-otp/reset-password', { email, otp: collectedCodes.get(email + ':forget-password'), password: ownerPassword });
    assert.equal(response.status, 200);
    assert.equal((await request('/sign-in/email', { email, password: ownerPassword })).status, 200);
    assert.equal((await request('/sign-in/email', { email, password: attackerPassword })).status, 401);
    await request('/sign-out', {});
    cookie = '';
  });
});
