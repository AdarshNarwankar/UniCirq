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
let cookie = '';
const auth = defineAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  origin,
  secret: 'test-only-prisma-auth-secret-with-at-least-thirty-two-characters',
  sendCode: async (_, otp) => { code = otp; },
});

async function request(path: string, data?: object, originHeader = origin) {
  return auth.handler(new Request(origin + '/api/auth' + path, {
    method: data ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      origin: originHeader,
      'x-forwarded-for': '127.0.0.1',
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
