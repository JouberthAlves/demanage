/* eslint-disable simple-import-sort/imports -- db-env must load before importing app/Prisma */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { skipGeneralMutationLimit, skipReadLimit } from '@/app';

test('ordinary navigation, health checks and session restoration cannot exhaust the write budget', () => {
  for (const path of ['/health', '/auth/me', '/expenses', '/entries']) {
    assert.equal(skipGeneralMutationLimit('GET', path), true, path);
    assert.equal(skipGeneralMutationLimit('HEAD', path), true, path);
  }
  assert.equal(skipGeneralMutationLimit('OPTIONS', '/entries'), true);
  assert.equal(skipReadLimit('GET', '/health'), true);
  assert.equal(skipReadLimit('GET', '/auth/me'), true);
  assert.equal(skipReadLimit('GET', '/auth/me/'), true);
  assert.equal(skipReadLimit('GET', '/entries'), false);
  assert.equal(skipReadLimit('GET', '/expenses'), false);
});

test('writes still rate-limit and login/recovery retain their independent stricter limiter', () => {
  for (const path of ['/entries', '/expenses', '/piggy-banks/process-auto-debit']) {
    assert.equal(skipGeneralMutationLimit('POST', path), false, path);
    assert.equal(skipReadLimit('POST', path), true, path);
  }
  for (const path of ['/auth/login', '/auth/register', '/auth/recovery-code', '/auth/recover-password']) {
    assert.equal(skipGeneralMutationLimit('POST', path), true, path);
    assert.equal(skipReadLimit('POST', path), true, path);
  }
  assert.equal(skipGeneralMutationLimit('POST', '/auth/login/'), true);
});

test('many page reloads cannot block health, login or a real save, but abusive writes still receive 429', async () => {
  const app = express();
  app.use(rateLimit({
    windowMs: 60_000, limit: 1,
    skip: (req) => skipGeneralMutationLimit(req.method, req.path),
  }));
  app.use(rateLimit({
    windowMs: 60_000, limit: 2,
    skip: (req) => skipReadLimit(req.method, req.path),
  }));
  const loginLimiter = rateLimit({ windowMs: 60_000, limit: 1 });
  app.get('/health', (_req, res) => { res.sendStatus(200); });
  app.get('/auth/me', (_req, res) => { res.sendStatus(401); });
  app.get('/entries', (_req, res) => { res.sendStatus(200); });
  app.post('/auth/login', loginLimiter, (_req, res) => { res.sendStatus(401); });
  app.post('/entries', (_req, res) => { res.sendStatus(201); });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (let i = 0; i < 5; i++) {
      assert.equal((await fetch(`${url}/health`)).status, 200);
      assert.equal((await fetch(`${url}/auth/me`)).status, 401);
    }
    assert.equal((await fetch(`${url}/entries`)).status, 200);
    assert.equal((await fetch(`${url}/entries`)).status, 200);
    assert.equal((await fetch(`${url}/entries`)).status, 429);
    assert.equal((await fetch(`${url}/auth/login`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${url}/auth/login`, { method: 'POST' })).status, 429);
    assert.equal((await fetch(`${url}/entries`, { method: 'POST' })).status, 201);
    assert.equal((await fetch(`${url}/entries`, { method: 'POST' })).status, 429);
    assert.equal((await fetch(`${url}/health`)).status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
