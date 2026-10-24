/* eslint-disable simple-import-sort/imports -- Set DATABASE_URL before OAuth imports Prisma. */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';

import { createOAuthProvider } from '@/oauth/provider';
import { createOAuthDiscoveryRouter, createOAuthRouter } from '@/routes/oauth';

test('nested OAuth authorization-server discovery uses the canonical public issuer endpoints', async () => {
  const app = express();
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const issuer = `${base}/api/oauth`;

  try {
    const signingKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });
    const provider = createOAuthProvider({
      issuer,
      resource: `${base}/api/mcp`,
      cookieKeys: ['disposable-c05-oauth-cookie-key-0123456789'],
      jwks: { keys: [{ ...signingKey, alg: 'RS256', use: 'sig', kid: 'disposable-c05' }] },
      clients: [],
    });
    app.use(createOAuthDiscoveryRouter(provider));
    // nginx strips /api/ for discovery requests, forwarding the public
    // /api/oauth/.well-known/* URL to the backend /oauth/.well-known/* path.
    app.use('/oauth', createOAuthRouter(provider));
    app.use('/api/oauth', createOAuthRouter(provider));

    for (const path of [
      '/.well-known/oauth-authorization-server/api/oauth',
      '/api/oauth/.well-known/oauth-authorization-server',
      '/oauth/.well-known/oauth-authorization-server',
    ]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, `${path} should return OAuth discovery`);
      const metadata = await response.json() as Record<string, unknown>;
      assert.deepEqual({
        issuer: metadata.issuer,
        authorization_endpoint: metadata.authorization_endpoint,
        token_endpoint: metadata.token_endpoint,
        revocation_endpoint: metadata.revocation_endpoint,
        jwks_uri: metadata.jwks_uri,
      }, {
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        revocation_endpoint: `${issuer}/token/revocation`,
        jwks_uri: `${issuer}/jwks`,
      }, `${path} must advertise only the public /api/oauth endpoints`);
      assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ['none', 'private_key_jwt']);
      assert.deepEqual(metadata.token_endpoint_auth_signing_alg_values_supported, ['RS256']);
      assert.equal(metadata.registration_endpoint, undefined, 'DCR must not be advertised');
      assert.equal(metadata.client_id_metadata_document_supported, true);
    }

    const authorization = await fetch(`${issuer}/auth`);
    assert.equal(authorization.status, 400, 'advertised authorization path must reach the provider');
    const token = await fetch(`${issuer}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'not-a-real-grant' }),
    });
    assert.equal(token.status, 400, 'advertised token path must reach the provider');

    const registration = await fetch(`${issuer}/reg`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.ok(registration.status >= 400, 'dynamic client registration must remain disabled');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
