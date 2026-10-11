/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createApp } from './app';

async function withServer(
  run: (
    request: (path: string, init?: RequestInit) => Promise<Response>,
  ) => Promise<void>,
) {
  const server = createApp({ logRequests: false }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run((path, init) => fetch(`${origin}${path}`, init));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const json = (body: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
});

test('createApp serves health without listening on its own', async () => {
  await withServer(async (request) => {
    const response = await request('/health');
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { status: string }).status, 'ok');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('unknown routes and unauthenticated access return JSON errors', async () => {
  await withServer(async (request) => {
    const missing = await request('/nao-existe');
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Rota não encontrada' });

    for (const path of [
      '/entries',
      '/expenses',
      '/cards',
      '/piggy-banks',
      '/auth/me',
    ]) {
      const response = await request(path);
      assert.equal(response.status, 401, path);
      assert.deepEqual(await response.json(), { error: 'Não autenticado' });
    }
  });
});

test('body parser failures are 4xx and missing or non-string fields are 400', async () => {
  await withServer(async (request) => {
    const malformed = await request('/auth/login', json('{not json'));
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: 'JSON inválido' });

    const tooLarge = await request(
      '/auth/login',
      json(JSON.stringify({ email: 'x'.repeat(300_000) })),
    );
    assert.equal(tooLarge.status, 413);

    const noBody = await request('/auth/login', { method: 'POST' });
    assert.equal(noBody.status, 400);

    const wrongTypes = await request(
      '/auth/login',
      json(JSON.stringify({ email: 42, password: ['x'] })),
    );
    assert.equal(wrongTypes.status, 400);

    const recover = await request(
      '/auth/recover-password',
      json(JSON.stringify({ email: {}, recoveryCode: 7, newPassword: 'x' })),
    );
    assert.equal(recover.status, 400);

    const register = await request(
      '/auth/register',
      json(JSON.stringify({ name: 'A', email: 'a@b.c', password: 'curta' })),
    );
    assert.equal(register.status, 400);
  });
});
