/* eslint-disable simple-import-sort/imports -- configure test DATABASE_URL before importing Prisma consumers */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createApp } from '@/app';

const trustedOrigin = 'http://localhost:3000';
const hostileOrigin = 'https://attacker.example';

async function withHttpServer(run: (request: (path: string, init?: RequestInit) => Promise<Response>) => Promise<void>) {
  const server = createApp({ logRequests: false }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run((path, init) => fetch(`${base}${path}`, init));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const json = (headers: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: '{}',
});

test('session-establishing routes reject hostile browser origins and cross-site Fetch Metadata before an auth cookie exists', async () => {
  await withHttpServer(async (request) => {
    const attacks: Record<string, string>[] = [
      { Origin: hostileOrigin },
      { Origin: 'null' },
      { Origin: hostileOrigin, Referer: `${trustedOrigin}/login` },
      { Referer: `${hostileOrigin}/login` },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
    ];
    for (const path of ['/auth/login', '/auth/register', '/auth/recover-password']) {
      for (const headers of attacks) {
        const response = await request(path, json(headers));
        assert.equal(response.status, 403, `${path} must reject ${JSON.stringify(headers)}`);
        assert.deepEqual(await response.json(), { error: 'Origem da requisição inválida' });
      }
      const trusted = await request(path, json({ Origin: trustedOrigin }));
      assert.equal(trusted.status, 400, `${path} must accept a trusted browser origin and then validate body`);
      const trustedReferer = await request(path, json({ Referer: `${trustedOrigin}/login` }));
      assert.equal(trustedReferer.status, 400, `${path} must accept a trusted Referer fallback`);
      const nativeApi = await request(path, json());
      assert.equal(nativeApi.status, 400, `${path} must preserve native API clients with no browser headers`);
      const sameOriginFetch = await request(path, json({ 'Sec-Fetch-Site': 'same-origin' }));
      assert.equal(sameOriginFetch.status, 400, `${path} must permit same-origin browsers without Origin`);
    }
  });
});

test('cookie-authenticated writes and pre-auth trusted-device ceremonies reject hostile origins; unauthenticated reads remain unaffected', async () => {
  await withHttpServer(async (request) => {
    for (const path of ['/entries', '/auth/logout']) {
      const crossSite = await request(path, json({ Cookie: 'demanage-token=not-a-jwt', Origin: hostileOrigin }));
      assert.equal(crossSite.status, 403, path);
      const missing = await request(path, json({ Cookie: 'demanage-token=not-a-jwt' }));
      assert.equal(missing.status, 403, path);
    }

    for (const path of ['/auth/trusted-device/challenge', '/auth/trusted-device/login']) {
      const attacks: Record<string, string>[] = [{ Origin: hostileOrigin }, {}];
      for (const headers of attacks) {
        const response = await request(path, json(headers));
        assert.equal(response.status, 403, `${path} ${JSON.stringify(headers)}`);
      }
    }

    const unauthenticated = await request('/entries', json({ Origin: hostileOrigin }));
    assert.equal(unauthenticated.status, 401);
    const safeRead = await request('/auth/me', {
      headers: { Cookie: 'demanage-token=not-a-jwt', Origin: hostileOrigin },
    });
    assert.equal(safeRead.status, 401);
  });
});
