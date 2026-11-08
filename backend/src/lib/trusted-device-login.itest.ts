/* eslint-disable simple-import-sort/imports -- load DB environment first */
import '@/test-support/db-env';

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

const CORRECT = 'OriginalPassword123!';
const WRONG = 'DefinitelyIncorrect!';
const RECOVERY = '23456-789AB-CDEFG-HJKLM';
type Reply = { response: Response; data: Record<string, unknown> };

async function withServer(run: (request: (path: string, body?: unknown, opts?: {
  cookie?: string; ip?: string; origin?: string | null; method?: string;
}) => Promise<Reply>) => Promise<void>) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(csrfProtection);
  app.use(express.json());
  const ipLimiter = rateLimit({ windowMs: 60_000, limit: 20,
    standardHeaders: false, legacyHeaders: false,
    message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' } });
  for (const path of ['/auth/login', '/auth/trusted-device/enroll', '/auth/trusted-device/challenge',
    '/auth/trusted-device/login', '/auth/trusted-device/revoke', '/auth/recover-password']) {
    app.use(path, ipLimiter);
  }
  app.post('/auth/login', createLoginFailureLimiter({ windowMs: 60_000, limit: 10 }));
  app.use(authRoutes);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run(async (path, body, opts = {}) => {
      const response = await fetch(`${origin}${path}`, {
        method: opts.method ?? 'POST',
        headers: {
          ...(opts.origin === null ? {} : { Origin: opts.origin ?? origin }),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
          ...(opts.ip ? { 'X-Forwarded-For': opts.ip } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { response, data: await response.json() as Record<string, unknown> };
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function cookieOf(response: Response, name: string) {
  return response.headers.getSetCookie().map((value) => value.split(';')[0]!)
    .find((value) => value.startsWith(`${name}=`)) ?? null;
}

test('enrolled device + password unlocks after 10 distributed email failures without relaxing either limiter', async () => {
  const email = `trusted-${randomUUID()}@example.invalid`;
  const user = await prisma.user.create({ data: {
    name: 'Trusted login test', email, passwordHash: await hashPassword(CORRECT),
    recoveryCodeHash: hashRecoveryCode(RECOVERY),
  } });
  try {
    await withServer(async (request) => {
      const authCookie = `${AUTH_COOKIE_NAME}=${signAuthToken(user.id, user.sessionVersion)}`;
      const enroll = await request('/auth/trusted-device/enroll', { currentPassword: CORRECT,
        label: 'Notebook pessoal' }, { cookie: authCookie });
      assert.equal(enroll.response.status, 201);
      const deviceCookie = cookieOf(enroll.response, 'demanage-trusted-device');
      assert.ok(deviceCookie, 'secret only travels in an HttpOnly Set-Cookie');
      assert.match(enroll.response.headers.get('set-cookie')!, /HttpOnly/);
      assert.equal(enroll.data.secret, undefined);
      const storedDevice = await prisma.trustedLoginDevice.findUniqueOrThrow({
        where: { id: enroll.data.id as string },
      });
      const browserSecret = deviceCookie!.split('=')[1]!.split('.')[1]!;
      assert.match(storedDevice.secretHash, /^[a-f0-9]{64}$/u);
      assert.equal(storedDevice.secretHash.includes(browserSecret), false,
        'the database must never retain the browser possession secret in plaintext');

      for (let i = 1; i <= 10; i++) {
        const denied = await request('/auth/login', { email, password: WRONG },
          { ip: `198.51.100.${i}` });
        assert.equal(denied.response.status, 401);
      }
      assert.equal((await request('/auth/login', { email, password: CORRECT },
        { ip: '198.51.100.50' })).response.status, 429);

      const proof = await request('/auth/trusted-device/challenge', {},
        { cookie: deviceCookie!, ip: '198.51.100.51' });
      assert.equal(proof.response.status, 200);
      const { challengeId, nonce } = proof.data;
      assert.equal(typeof challengeId, 'string');
      assert.equal(typeof nonce, 'string');
      const loginBody = { email, password: CORRECT, challengeId, nonce };
      const authenticated = await request('/auth/trusted-device/login', loginBody,
        { cookie: deviceCookie!, ip: '198.51.100.52' });
      assert.equal(authenticated.response.status, 200);
      assert.equal((authenticated.data.user as { id: string }).id, user.id);
      assert.ok(cookieOf(authenticated.response, AUTH_COOKIE_NAME));
      assert.equal((await request('/auth/trusted-device/login', loginBody,
        { cookie: deviceCookie!, ip: '198.51.100.53' })).response.status, 401,
      'a consumed proof cannot be replayed');
      assert.equal((await request('/auth/login', { email, password: CORRECT },
        { ip: '198.51.100.54' })).response.status, 429,
      'original identifier HMAC quota remains exhausted');

      const trustedSession = cookieOf(authenticated.response, AUTH_COOKIE_NAME)!;
      assert.equal((await request('/auth/logout', {}, { cookie: trustedSession })).response.status, 200);
      assert.equal((await request('/auth/me', undefined, { method: 'GET', cookie: trustedSession })).response.status, 401);
      const laterProof = await request('/auth/trusted-device/challenge', {}, { cookie: deviceCookie! });
      const laterLogin = await request('/auth/trusted-device/login', { email, password: CORRECT,
        challengeId: laterProof.data.challengeId, nonce: laterProof.data.nonce }, { cookie: deviceCookie! });
      assert.equal(laterLogin.response.status, 200,
        'explicit logout revokes a session but intentionally retains opt-in device possession');

      const recovered = await request('/auth/recover-password', {
        email, recoveryCode: RECOVERY, newPassword: 'AnotherPassword123!',
      }, { ip: '198.51.100.55' });
      assert.equal(recovered.response.status, 200);
      const invalidProof = await request('/auth/trusted-device/challenge', {}, { cookie: deviceCookie! });
      assert.equal((await request('/auth/trusted-device/login', { email,
        password: 'AnotherPassword123!', challengeId: invalidProof.data.challengeId,
        nonce: invalidProof.data.nonce }, { cookie: deviceCookie! })).response.status, 401,
      'password recovery revokes every previously trusted device');
    });
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('device failures are bounded across IPs; malformed, expired, and cross-origin proofs fail closed', async () => {
  const email = `trusted-adversary-${randomUUID()}@example.invalid`;
  const user = await prisma.user.create({ data: {
    name: 'Trusted adversarial test', email, passwordHash: await hashPassword(CORRECT),
  } });
  try {
    await withServer(async (request) => {
      const authCookie = `${AUTH_COOKIE_NAME}=${signAuthToken(user.id, 0)}`;
      const enrolled = await request('/auth/trusted-device/enroll', { currentPassword: CORRECT },
        { cookie: authCookie });
      assert.equal(enrolled.response.status, 201);
      const device = cookieOf(enrolled.response, 'demanage-trusted-device')!;
      const noDevice = await request('/auth/trusted-device/challenge', {});
      const realShape = await request('/auth/trusted-device/challenge', {}, { cookie: device });
      assert.deepEqual(Object.keys(noDevice.data).sort(), Object.keys(realShape.data).sort(),
        'public challenge response must not identify account or device enrollment');
      const unknown = await request('/auth/trusted-device/login', {
        email, password: CORRECT, challengeId: noDevice.data.challengeId, nonce: noDevice.data.nonce,
      });
      assert.equal(unknown.response.status, 401);
      assert.equal(cookieOf(unknown.response, AUTH_COOKIE_NAME), null);
      const crossSite = await request('/auth/trusted-device/challenge', {},
        { cookie: device, origin: 'https://attacker.example' });
      const noOrigin = await request('/auth/trusted-device/challenge', {},
        { cookie: device, origin: null });
      assert.equal(crossSite.response.status, 403);
      assert.equal(noOrigin.response.status, 403);
      for (const route of ['/auth/trusted-device/login', '/auth/trusted-device/enroll',
        '/auth/trusted-device/revoke']) {
        assert.equal((await request(route, {}, { cookie: `${authCookie}; ${device}`,
          origin: 'https://attacker.example' })).response.status, 403, route);
        assert.equal((await request(route, {}, { cookie: `${authCookie}; ${device}`,
          origin: null })).response.status, 403, route);
      }

      const expired = await request('/auth/trusted-device/challenge', {}, { cookie: device });
      await prisma.trustedLoginChallenge.update({ where: { id: expired.data.challengeId as string },
        data: { expiresAt: new Date(Date.now() - 1_000) } });
      assert.equal((await request('/auth/trusted-device/login', {
        email, password: CORRECT, challengeId: expired.data.challengeId, nonce: expired.data.nonce,
      }, { cookie: device })).response.status, 401);

      for (let i = 1; i <= 5; i++) {
        const proof = await request('/auth/trusted-device/challenge', {}, { cookie: device,
          ip: `198.51.100.${i}` });
        const failed = await request('/auth/trusted-device/login', { email,
          password: WRONG, challengeId: proof.data.challengeId, nonce: proof.data.nonce },
        { cookie: device, ip: `198.51.100.${i}` });
        assert.equal(failed.response.status, 401);
      }
      const last = await request('/auth/trusted-device/challenge', {},
        { cookie: device, ip: '198.51.100.50' });
      assert.equal((await request('/auth/trusted-device/login', { email, password: CORRECT,
        challengeId: last.data.challengeId, nonce: last.data.nonce },
      { cookie: device, ip: '198.51.100.51' })).response.status, 429,
      'owning the device cookie must not grant an unlimited distributed password oracle');
      assert.equal((await prisma.trustedLoginDevice.findFirstOrThrow({ where: { userId: user.id } })).failedAttempts, 5);
      const revoke = await request('/auth/trusted-device/revoke', {
        deviceId: enrolled.data.id, currentPassword: CORRECT,
      }, { cookie: `${authCookie}; ${device}` });
      assert.equal(revoke.response.status, 200);
      assert.equal((await prisma.trustedLoginDevice.findFirstOrThrow({ where: { userId: user.id } })).revokedAt !== null, true);
      const afterRevoke = await request('/auth/trusted-device/challenge', {}, { cookie: device });
      assert.equal((await request('/auth/trusted-device/login', { email, password: CORRECT,
        challengeId: afterRevoke.data.challengeId, nonce: afterRevoke.data.nonce },
      { cookie: device })).response.status, 401);
    });
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('concurrent distributed wrong-password proofs commit only five failures under PG row lock', async () => {
  const email = `trusted-concurrent-${randomUUID()}@example.invalid`;
  const user = await prisma.user.create({ data: { name: 'Concurrent proof', email,
    passwordHash: await hashPassword(CORRECT) } });
  try {
    await withServer(async (request) => {
      const authCookie = `${AUTH_COOKIE_NAME}=${signAuthToken(user.id, 0)}`;
      const enrolled = await request('/auth/trusted-device/enroll', { currentPassword: CORRECT },
        { cookie: authCookie });
      assert.equal(enrolled.response.status, 201);
      const device = cookieOf(enrolled.response, 'demanage-trusted-device')!;
      let denied = 0;
      let limited = 0;
      for (let wave = 0; wave < 4; wave++) {
        const count = wave === 3 ? 1 : 3;
        const challenges = await Promise.all(Array.from({ length: count }, (_, index) =>
          request('/auth/trusted-device/challenge', {}, { cookie: device,
            ip: `198.51.100.${wave * 3 + index + 1}` })));
        const results = await Promise.all(challenges.map((challenge, index) =>
          request('/auth/trusted-device/login', { email, password: WRONG,
            challengeId: challenge.data.challengeId, nonce: challenge.data.nonce },
          { cookie: device, ip: `198.51.100.${wave * 3 + index + 1}` })));
        for (const { response } of results) {
          if (response.status === 401) denied++;
          else if (response.status === 429) limited++;
          else assert.fail(`Unexpected ${response.status} during concurrent brute-force`);
        }
      }
      assert.equal(denied, 5);
      assert.equal(limited, 5);
      assert.equal((await prisma.trustedLoginDevice.findFirstOrThrow({ where: { userId: user.id } })).failedAttempts, 5);
      assert.ok((await prisma.trustedLoginChallenge.count({ where: {
        deviceId: enrolled.data.id as string, usedAt: null, expiresAt: { gt: new Date() },
      } })) <= 3, 'challenge cardinality is bounded per credential');
    });
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('concurrent enrollment reproof is budgeted across IPs and offline recovery restores availability', async () => {
  const email = `trusted-reproof-${randomUUID()}@example.invalid`;
  const user = await prisma.user.create({ data: {
    name: 'Reproof budget test', email, passwordHash: await hashPassword(CORRECT),
    recoveryCodeHash: hashRecoveryCode(RECOVERY),
  } });
  try {
    await withServer(async (request) => {
      const session = `${AUTH_COOKIE_NAME}=${signAuthToken(user.id, 0)}`;
      const outcomes = await Promise.all(Array.from({ length: 10 }, (_, index) =>
        request('/auth/trusted-device/enroll', { currentPassword: WRONG },
          { cookie: session, ip: `198.51.100.${index + 10}` })));
      const statuses = outcomes.map(({ response }) => response.status).sort();
      assert.deepEqual(statuses, [...Array(5).fill(401), ...Array(5).fill(429)],
        'per-user 5/15m PG row-locked proof budget must not permit a race to 500');
      const exhausted = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(exhausted.trustedProofFailures, 5);
      assert.equal(await prisma.trustedLoginDevice.count({ where: { userId: user.id } }), 0);
      assert.equal((await request('/auth/trusted-device/enroll', {
        currentPassword: CORRECT,
      }, { cookie: session, ip: '198.51.100.50' })).response.status, 429,
      'valid password must not bypass the fresh-proof brute-force budget');

      const recovery = await request('/auth/recover-password', {
        email, recoveryCode: RECOVERY, newPassword: 'ChangedPassword123!',
      }, { ip: '198.51.100.51' });
      assert.equal(recovery.response.status, 200);
      const restoredSession = cookieOf(recovery.response, AUTH_COOKIE_NAME)!;
      const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      assert.equal(refreshed.trustedProofFailures, 0);
      assert.equal(refreshed.trustedProofWindowAt, null);
      const restoredEnroll = await request('/auth/trusted-device/enroll', {
        currentPassword: 'ChangedPassword123!',
      }, { cookie: restoredSession, ip: '198.51.100.52' });
      assert.equal(restoredEnroll.response.status, 201);
    });
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
