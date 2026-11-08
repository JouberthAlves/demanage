import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { createLoginFailureLimiter } from './login-failure-limiter';

type ResponseBody = { error?: string; ok?: boolean };

async function withLoginServer(
  run: (
    attempt: (
      email: unknown,
      password: unknown,
      ip: string,
    ) => Promise<{ status: number; body: ResponseBody }>,
  ) => Promise<void>,
  { windowMs = 60_000, limit = 3 }: { windowMs?: number; limit?: number } = {},
) {
  const app = express();
  // Test harness models the single trusted nginx hop which overwrites XFF.
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(
    rateLimit({
      windowMs,
      limit: 20,
      standardHeaders: false,
      legacyHeaders: false,
      message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
    }),
  );
  app.post(
    '/auth/login',
    createLoginFailureLimiter({ windowMs, limit }),
    (req, res) => {
      const { email, password } = req.body as {
        email?: unknown;
        password?: unknown;
      };
      if (
        typeof email !== 'string' ||
        !email.trim() ||
        typeof password !== 'string' ||
        !password
      ) {
        res.status(400).json({ error: 'Campos obrigatórios: email, password' });
        return;
      }
      if (
        email.trim().toLowerCase() === 'registered@example.invalid' &&
        password === 'right-password'
      ) {
        res.status(200).json({ ok: true });
        return;
      }
      res.status(401).json({ error: 'E-mail ou senha inválidos' });
    },
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth/login`;
  try {
    await run(async (email, password, ip) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify({ email, password }),
      });
      return {
        status: response.status,
        body: (await response.json()) as ResponseBody,
      };
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('failed account attempts from distinct IPs share one quota and do not enumerate registered email', async () => {
  await withLoginServer(async (attempt) => {
    const ip = (index: number) => `198.51.100.${index}`;
    for (const email of [
      'registered@example.invalid',
      'missing@example.invalid',
    ]) {
      for (let i = 1; i <= 3; i++) {
        const response = await attempt(email, 'wrong-password', ip(i));
        assert.equal(response.status, 401);
        assert.deepEqual(response.body, { error: 'E-mail ou senha inválidos' });
      }
      const blocked = await attempt(email, 'wrong-password', ip(4));
      assert.equal(blocked.status, 429);
      assert.deepEqual(blocked.body, {
        error: 'Muitas tentativas. Tente novamente em alguns minutos.',
      });
    }
    assert.equal(
      (await attempt(' REGISTERED@EXAMPLE.INVALID ', 'wrong-password', ip(9)))
        .status,
      429,
    );
    // Same NAT visitor IP can still access a different account (IP limit remains separate).
    assert.equal(
      (await attempt('another@example.invalid', 'wrong-password', ip(4)))
        .status,
      401,
    );
  });
});

test('successful logins do not consume the failed-identifier budget; malformed bodies cannot lock accounts', async () => {
  await withLoginServer(async (attempt) => {
    for (let i = 0; i < 6; i++) {
      assert.equal(
        (await attempt('missing-fields@example.invalid', null, '198.51.100.20'))
          .status,
        400,
      );
    }
    assert.equal(
      (
        await attempt(
          'missing-fields@example.invalid',
          'wrong',
          '198.51.100.20',
        )
      ).status,
      401,
    );

    assert.equal(
      (await attempt('registered@example.invalid', 'wrong', '198.51.100.20'))
        .status,
      401,
    );
    assert.equal(
      (await attempt('registered@example.invalid', 'wrong', '198.51.100.21'))
        .status,
      401,
    );
    assert.equal(
      (
        await attempt(
          'registered@example.invalid',
          'right-password',
          '198.51.100.22',
        )
      ).status,
      200,
    );
    assert.equal(
      (await attempt('registered@example.invalid', 'wrong', '198.51.100.23'))
        .status,
      401,
    );
    assert.equal(
      (await attempt('registered@example.invalid', 'wrong', '198.51.100.24'))
        .status,
      429,
    );
  });
});

test('ten distributed failures deny a subsequent correct login for the same identifier', async () => {
  await withLoginServer(async (attempt) => {
    for (const email of ['registered@example.invalid', 'missing@example.invalid']) {
      for (let i = 1; i <= 10; i++) {
        const response = await attempt(email, 'wrong-password', `198.51.100.${i}`);
        assert.equal(response.status, 401);
        assert.deepEqual(response.body, { error: 'E-mail ou senha inválidos' });
      }
    }

    const deniedValid = await attempt('registered@example.invalid', 'right-password', '198.51.100.4');
    const deniedUnknown = await attempt('missing@example.invalid', 'wrong-password', '198.51.100.5');
    assert.equal(deniedValid.status, 429, 'correct credentials cannot pass after identifier budget is spent');
    assert.equal(deniedUnknown.status, 429);
    assert.deepEqual(deniedValid.body, deniedUnknown.body, '429 must not enumerate registered identities');
  }, { limit: 10 });
});

test('identifier lockout expires with its configured window', async () => {
  await withLoginServer(async (attempt) => {
    assert.equal((await attempt('registered@example.invalid', 'wrong', '198.51.100.30')).status, 401);
    assert.equal((await attempt('registered@example.invalid', 'right-password', '198.51.100.31')).status, 429);
    // Small window models the 15-minute production expiration without sleeping 15 minutes.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const recovered = await attempt('registered@example.invalid', 'right-password', '198.51.100.6');
    assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.body, { ok: true });
    assert.equal((await attempt('missing@example.invalid', 'wrong-password', '198.51.100.7')).status, 401);
  }, { windowMs: 400, limit: 1 });
});

test('twenty distinct identifiers from one IP cannot bypass the independent IP ceiling', async () => {
  await withLoginServer(async (attempt) => {
    // One origin can create at most 20 identifier failures per window in this
    // harness; the production auth limiter is stricter (20 or 100 / 15 min).
    for (let i = 0; i < 20; i++) {
      const result = await attempt(`unique-${i}@example.invalid`, 'wrong-password', '198.51.100.50');
      assert.equal(result.status, 401);
    }
    assert.equal((await attempt('another-key@example.invalid', 'wrong-password', '198.51.100.50')).status, 429);
    // Other trusted source IPs still have independent per-IP quotas.
    assert.equal((await attempt('another-key@example.invalid', 'wrong-password', '198.51.100.51')).status, 401);
  });
});
