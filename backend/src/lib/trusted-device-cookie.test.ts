/* eslint-disable simple-import-sort/imports -- initialize DB test configuration first */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';

import {
  clearTrustedDeviceCookie,
  setTrustedDeviceCookie,
  TRUSTED_DEVICE_COOKIE_NAME,
} from '@/lib/trusted-device-login';

test('trusted-device issuance and revocation preserve browser-only cookie flags across environments', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/issue', (req, res) => {
    const opaquePossession = `${randomUUID()}.${randomBytes(32).toString('base64url')}`;
    setTrustedDeviceCookie(res, opaquePossession, req);
    res.json({ ok: true });
  });
  app.get('/revoke', (req, res) => {
    clearTrustedDeviceCookie(res, req);
    res.json({ ok: true });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    // Even a spoofed forwarded HTTP scheme must never downgrade production.
    const headers = { 'X-Forwarded-Proto': 'http', 'X-Forwarded-Host': 'proxy.example.invalid' };
    const issued = await fetch(`${origin}/issue`, { headers });
    assert.equal(issued.status, 200);
    const response = await issued.json() as Record<string, unknown>;
    assert.deepEqual(response, { ok: true }, 'possession secrets must never appear in JSON');

    const cookie = issued.headers.get('set-cookie');
    assert.ok(cookie);
    const production = process.env.NODE_ENV === 'production';
    assert.ok(cookie.startsWith(`${TRUSTED_DEVICE_COOKIE_NAME}=`));
    assert.match(cookie, /(?:^|;)\s*HttpOnly(?:;|$)/i);
    assert.match(cookie, /(?:^|;)\s*Path=\/(?:;|$)/i);
    assert.match(cookie, /(?:^|;)\s*Max-Age=2592000(?:;|$)/i);
    assert.doesNotMatch(cookie, /(?:^|;)\s*Domain=/i);
    assert.equal(TRUSTED_DEVICE_COOKIE_NAME.startsWith('__Host-'), production);

    const sameSiteNone = process.env.COOKIE_SAME_SITE === 'none' ||
      (production && process.env.COOKIE_SAME_SITE !== 'lax');
    assert.match(cookie, sameSiteNone ? /(?:^|;)\s*SameSite=None(?:;|$)/i :
      /(?:^|;)\s*SameSite=Lax(?:;|$)/i);
    const mustBeSecure = production || sameSiteNone;
    assert.equal(/(?:^|;)\s*Secure(?:;|$)/i.test(cookie), mustBeSecure,
      'production and SameSite=None cookies cannot travel over cleartext');

    const revoked = await fetch(`${origin}/revoke`, { headers });
    assert.equal(revoked.status, 200);
    const clear = revoked.headers.get('set-cookie');
    assert.ok(clear);
    assert.ok(clear.startsWith(`${TRUSTED_DEVICE_COOKIE_NAME}=`));
    assert.match(clear, /(?:^|;)\s*HttpOnly(?:;|$)/i);
    assert.match(clear, /(?:^|;)\s*Path=\/(?:;|$)/i);
    assert.equal(/(?:^|;)\s*Secure(?:;|$)/i.test(clear), mustBeSecure);
    assert.equal(/(?:^|;)\s*SameSite=None(?:;|$)/i.test(clear), sameSiteNone);
    assert.match(clear, /(?:^|;)\s*Expires=/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) =>
      error ? reject(error) : resolve()));
  }
});
