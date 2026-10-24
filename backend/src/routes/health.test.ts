/* eslint-disable simple-import-sort/imports -- initialize DATABASE_URL before importing the router */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';

import { createHealthRoutes } from './health';

async function probeReadiness(check: () => Promise<unknown>) {
  const app = express().use(createHealthRoutes(check));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const liveness = await fetch(`${origin}/health`);
    const readiness = await fetch(`${origin}/ready`);
    return {
      liveness: { status: liveness.status, data: await liveness.json() },
      readiness: { status: readiness.status, data: await readiness.json() },
    };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('readiness requires a successful SQL probe while liveness does not', async () => {
  let calls = 0;
  const success = await probeReadiness(async () => {
    calls += 1;
    return 1;
  });
  assert.equal(calls, 1);
  assert.equal(success.liveness.status, 200);
  assert.equal(success.readiness.status, 200);
  assert.equal(success.readiness.data.db, 'ready');

  const failed = await probeReadiness(async () => {
    throw new Error('private database connection secret');
  });
  assert.equal(failed.liveness.status, 200);
  assert.equal(failed.readiness.status, 503);
  assert.equal(failed.readiness.data.status, 'unavailable');
  assert.equal(failed.readiness.data.db, 'unavailable');
  assert.equal(JSON.stringify(failed.readiness.data).includes('secret'), false);
});
