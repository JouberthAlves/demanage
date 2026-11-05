import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { errorHandler } from '@/http/errors';
import { AUTH_COOKIE_NAME, hashPassword, signAuthToken } from '@/lib/auth';
import { createLoginFailureLimiter } from '@/lib/login-failure-limiter';
import { prisma } from '@/lib/prisma';
import { hashRecoveryCode } from '@/lib/recovery-code';
import { csrfProtection } from '@/middlewares/csrf-protection';
import authRoutes from '@/routes/auth';

const WRONG_PASSWORD = 'NotTheRightPassword!';
const CORRECT_PASSWORD = 'OriginalPassword123!';
const RECOVERY_CODE = '23456-789AB-CDEFG-HJKLM';
const LOGIN_LIMIT_MESSAGE = 'Muitas tentativas. Tente novamente em alguns minutos.';

async function withAuthHttp(run: (api: {
  request: (
    path: string, body?: unknown, options?: { ip?: string; cookie?: string; method?: string },
  ) => Promise<{ response: Response; data: Record<string, unknown> }>;
}) => Promise<void>) {
  const app = express();
  // Simulates the one trusted nginx hop. A forged leading XFF hop is ignored.
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(csrfProtection);
  app.use(express.json({ limit: '256kb' }));
  const ipLimiter = rateLimit({
    windowMs: 60_000, limit: 20, standardHeaders: false, legacyHeaders: false,
    message: { error: LOGIN_LIMIT_MESSAGE },
  });
  app.use('/auth/login', ipLimiter);
  app.use('/auth/recover-password', ipLimiter);
  app.post('/auth/login', createLoginFailureLimiter({ windowMs: 60_000, limit: 10 }));
  app.use(authRoutes);
  app.use(errorHandler);

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run({
      request: async (path, body, options = {}) => {
        const response = await fetch(`${origin}${path}`, {
          method: options.method ?? 'POST',
          headers: {
            Origin: origin,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(options.ip ? { 'X-Forwarded-For': options.ip } : {}),
            ...(options.cookie ? { Cookie: options.cookie } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { response, data: (await response.json()) as Record<string, unknown> };
      },
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()));
  }
}

test('offline recovery proof opens a new session while distributed login stuffing stays blocked', async () => {
  const email = `recovery-lockout-${randomUUID()}@example.invalid`;
  const user = await prisma.user.create({ data: {
    name: 'Recovery lockout test', email,
    passwordHash: await hashPassword(CORRECT_PASSWORD),
    recoveryCodeHash: hashRecoveryCode(RECOVERY_CODE),
  } });
  try {
    await withAuthHttp(async ({ request }) => {
      const login = (emailToTry: string, password: string, ip: string) =>
        request('/auth/login', { email: emailToTry, password }, { ip });
      const missingEmail = `missing-${randomUUID()}@example.invalid`;
      for (const candidate of [email, missingEmail]) {
        for (let i = 1; i <= 10; i++) {
          const wrong = await login(candidate, WRONG_PASSWORD, `198.51.100.${i}`);
          assert.equal(wrong.response.status, 401);
          assert.deepEqual(wrong.data, { error: 'E-mail ou senha inválidos' });
        }
      }

      const deniedVictim = await login(email, CORRECT_PASSWORD, '198.51.100.100');
      const deniedMissing = await login(missingEmail, WRONG_PASSWORD, '198.51.100.101');
      assert.equal(deniedVictim.response.status, 429);
      assert.equal(deniedMissing.response.status, 429);
      assert.deepEqual(deniedVictim.data, deniedMissing.data);

      const previousCookie = `${AUTH_COOKIE_NAME}=${signAuthToken(user.id, user.sessionVersion)}`;
      const invalid = await request('/auth/recover-password', {
        email, recoveryCode: 'INVALID-RECOVERY-CODE', newPassword: 'NewPassword123!',
      }, { ip: '198.51.100.110' });
      const nonexistent = await request('/auth/recover-password', {
        email: missingEmail, recoveryCode: 'INVALID-RECOVERY-CODE', newPassword: 'NewPassword123!',
      }, { ip: '198.51.100.111' });
      assert.equal(invalid.response.status, 401);
      assert.equal(nonexistent.response.status, 401);
      assert.deepEqual(invalid.data, nonexistent.data, 'recovery failures must not enumerate accounts');
      assert.equal(invalid.response.headers.get('set-cookie'), null);
      assert.equal((await login(email, CORRECT_PASSWORD, '198.51.100.112')).response.status, 429);

      const recovered = await request('/auth/recover-password', {
        email, recoveryCode: RECOVERY_CODE, newPassword: 'NewPassword123!',
      }, { ip: '198.51.100.113' });
      assert.equal(recovered.response.status, 200);
      const rotatedCode = recovered.data.recoveryCode;
      assert.equal(typeof rotatedCode, 'string');
      assert.notEqual(rotatedCode, RECOVERY_CODE);
      assert.equal((recovered.data.user as { id: string }).id, user.id);
      const cookieHeader = recovered.response.headers.get('set-cookie');
      assert.match(cookieHeader ?? '', new RegExp(`^${AUTH_COOKIE_NAME}=`));
      assert.match(cookieHeader ?? '', /HttpOnly/i);
      const newCookie = cookieHeader!.split(';')[0]!;

      const restored = await request('/auth/me', undefined, {
        method: 'GET', cookie: newCookie, ip: '198.51.100.114',
      });
      assert.equal(restored.response.status, 200, 'recovery must authenticate without a password retry');
      assert.equal((restored.data.user as { id: string }).id, user.id);
      const revoked = await request('/auth/me', undefined, {
        method: 'GET', cookie: previousCookie, ip: '198.51.100.114',
      });
      assert.equal(revoked.response.status, 401, 'old session epoch must remain revoked');
      assert.equal((await login(email, 'NewPassword123!', '198.51.100.115')).response.status, 429,
        'recovery never raises the brute-force budget');
      assert.equal((await login(missingEmail, WRONG_PASSWORD, '198.51.100.116')).response.status, 429,
        'other account quotas must remain untouched');

      const replay = await request('/auth/recover-password', {
        email, recoveryCode: RECOVERY_CODE, newPassword: 'AnotherPassword123!',
      }, { ip: '198.51.100.117' });
      assert.equal(replay.response.status, 401);
      assert.deepEqual(replay.data, invalid.data);
      assert.equal(replay.response.headers.get('set-cookie'), null);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(stored.sessionVersion, user.sessionVersion + 1);
      assert.equal(stored.recoveryCodeHash, hashRecoveryCode(rotatedCode as string));
    });
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('concurrent recovery requests issue exactly one valid session', async () => {
  const email = `concurrent-recovery-${randomUUID()}@example.invalid`;
  const user = await prisma.user.create({ data: {
    name: 'Concurrent recovery', email,
    passwordHash: await hashPassword(CORRECT_PASSWORD),
    recoveryCodeHash: hashRecoveryCode(RECOVERY_CODE),
  } });
  try {
    await withAuthHttp(async ({ request }) => {
      const body = { email, recoveryCode: RECOVERY_CODE, newPassword: 'NewPassword123!' };
      const [first, second] = await Promise.all([
        request('/auth/recover-password', body, { ip: '198.51.100.201' }),
        request('/auth/recover-password', body, { ip: '198.51.100.202' }),
      ]);
      assert.deepEqual([first.response.status, second.response.status].sort(), [200, 401]);
      const winner = first.response.status === 200 ? first : second;
      const loser = first.response.status === 401 ? first : second;
      assert.equal(loser.response.headers.get('set-cookie'), null);
      const cookie = winner.response.headers.get('set-cookie')?.split(';')[0];
      assert.ok(cookie);
      assert.equal((await request('/auth/me', undefined, {
        method: 'GET', cookie,
      })).response.status, 200);
      assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, 1);
    });
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('trusted proxy reads the nearest forwarded hop; forged earlier hops cannot evade the IP budget', async () => {
  await withAuthHttp(async ({ request }) => {
    for (let i = 0; i < 20; i++) {
      const wrong = await request('/auth/login', {
        email: `fake-${i}-${randomUUID()}@example.invalid`, password: WRONG_PASSWORD,
      }, { ip: `203.0.113.${i + 1}, 198.51.100.240` });
      assert.equal(wrong.response.status, 401);
    }
    assert.equal((await request('/auth/login', {
      email: `fake-last-${randomUUID()}@example.invalid`, password: WRONG_PASSWORD,
    }, { ip: '203.0.113.99, 198.51.100.240' })).response.status, 429);
    assert.equal((await request('/auth/login', {
      email: `fake-other-${randomUUID()}@example.invalid`, password: WRONG_PASSWORD,
    }, { ip: '203.0.113.99, 198.51.100.241' })).response.status, 401);
  });
});
