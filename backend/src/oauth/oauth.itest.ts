import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import cookieParser from 'cookie-parser';
import express from 'express';

import '@/test-support/db-env';

type CookieJar = Map<string, string>;

function verifier() { return randomBytes(32).toString('base64url'); }
function challenge(value: string) { return createHash('sha256').update(value).digest('base64url'); }

function rememberCookies(response: Response, jar: CookieJar) {
  for (const cookie of response.headers.getSetCookie()) {
    const item = cookie.split(';', 1)[0];
    const separator = item.indexOf('=');
    if (separator > 0) jar.set(item.slice(0, separator), item.slice(separator + 1));
  }
}

async function request(url: string, jar: CookieJar, options: RequestInit = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...options.headers, cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') },
    redirect: 'manual',
  });
  rememberCookies(response, jar);
  return response;
}

test('OAuth issuer PKCE, consent, scoped bearer and revocation isolate two accounts', { timeout: 60_000 }, async () => {
  process.env.APP_URL = 'http://127.0.0.1:5180';
  process.env.JWT_SECRET = 'disposable-oauth-integration-secret-2026-10-16-012345';

  const [{ prisma }, { signAuthToken }, { createOAuthProvider, getOAuthGrantSubject, revokeClientGrant }, { createOAuthRouter, createOAuthDiscoveryRouter }] = await Promise.all([
    import('@/lib/prisma'), import('@/lib/auth'), import('./provider'), import('@/routes/oauth'),
  ]);
  const users = await Promise.all([1, 2].map((id) => prisma.user.create({
    data: { email: `oauth-test-${id}-${randomUUID()}@example.invalid`, name: `OAuth user ${id}`, passwordHash: 'never-used' },
  })));
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });
  const callback = 'http://127.0.0.1:5199/finish';
  const clientId = 'oauth-local-public-test';
  const resource = 'http://127.0.0.1:5180/api/mcp';
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const provider = createOAuthProvider({
    issuer: `${base}/oauth`,
    resource,
    cookieKeys: ['disposable-oidc-cookie-key-0123456789-supersecret'],
    jwks: { keys: [{ ...key, alg: 'RS256', use: 'sig', kid: 'disposable-key' }] },
    clients: [{ client_id: clientId, redirect_uris: [callback], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' }],
  });
  app.use(createOAuthDiscoveryRouter(provider));
  app.use('/oauth', createOAuthRouter(provider));

  async function authorize(userIndex: number, scope: string) {
    const user = users[userIndex];
    const jar = new Map<string, string>([['demanage-token', signAuthToken(user.id, user.sessionVersion)]]);
    const pkceVerifier = verifier();
    const url = new URL(`${base}/oauth/auth`);
    url.search = new URLSearchParams({
      client_id: clientId, redirect_uri: callback, response_type: 'code', scope,
      code_challenge: challenge(pkceVerifier), code_challenge_method: 'S256',
      resource, state: `state-${randomUUID()}`,
    }).toString();
    let response = await request(url.toString(), jar);
    for (let attempts = 0; attempts < 8; attempts++) {
      assert.equal(response.status, 303, `OAuth flow unexpected status ${response.status}: ${(await response.clone().text()).slice(0, 300)}`);
      const redirect = response.headers.get('location');
      assert.ok(redirect, 'OAuth flow requires redirect');
      const destination = new URL(redirect, base);
      if (destination.origin === new URL(callback).origin && destination.pathname === '/finish') {
        assert.equal(destination.searchParams.get('iss'), `${base}/oauth`, 'RFC 9207 issuer must match discovery');
        const code = destination.searchParams.get('code');
        assert.ok(code, `OAuth rejected: ${destination.searchParams.get('error')}`);
        return { code, pkceVerifier, jar };
      }
      if (destination.pathname === '/oauth/consent') {
        const uid = destination.searchParams.get('uid');
        assert.ok(uid);
        const details = await request(`${base}/oauth/interaction/${encodeURIComponent(uid)}`, jar);
        assert.equal(details.status, 200, `Consent details: ${await details.clone().text()}`);
        const info = await details.json() as { csrf: string; scopes: string[] };
        assert.ok(info.scopes.includes(scope.split(' ').find((value) => value.startsWith('finance:'))!));
        response = await request(`${base}/oauth/interaction/${encodeURIComponent(uid)}/finish`, jar, {
          method: 'POST',
          headers: { origin: process.env.APP_URL!, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ csrf: info.csrf, decision: 'approve' }),
        });
      } else {
        response = await request(destination.toString(), jar);
      }
    }
    throw new Error('OAuth consent flow did not terminate');
  }

  async function exchange(code: string, pkceVerifier: string) {
    return fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: callback, code, code_verifier: pkceVerifier, resource }),
    });
  }

  try {
    for (const path of [
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/api/oauth',
    ]) {
      const metadata = await fetch(`${base}${path}`);
      assert.equal(metadata.status, 200);
      const advertised = await metadata.json() as Record<string, unknown>;
      assert.equal(advertised.issuer, `${base}/oauth`);
      assert.equal(advertised.client_id_metadata_document_supported, true);
      assert.equal(advertised.authorization_response_iss_parameter_supported, true);
      assert.equal(advertised.registration_endpoint, undefined, 'DCR is disabled');
      assert.deepEqual(advertised.code_challenge_methods_supported, ['S256']);
      assert.deepEqual(advertised.token_endpoint_auth_methods_supported, ['none']);
    }

    // RFC 9207 also requires `iss` on redirectable authorization errors.
    const noPrompt = new URL(`${base}/oauth/auth`);
    noPrompt.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callback,
      response_type: 'code',
      scope: 'finance:read',
      resource,
      prompt: 'none',
      code_challenge: challenge(verifier()),
      code_challenge_method: 'S256',
    }).toString();
    const errorResponse = await request(noPrompt.toString(), new Map());
    assert.equal(errorResponse.status, 303);
    const errorLocation = errorResponse.headers.get('location');
    assert.ok(errorLocation);
    const errorRedirect = new URL(errorLocation, base);
    assert.ok(errorRedirect.searchParams.get('error'), 'prompt=none must return a redirectable authorization error');
    assert.equal(errorRedirect.searchParams.get('iss'), `${base}/oauth`);

    const first = await authorize(0, 'finance:read');
    const rejectedVerifier = await exchange(first.code, verifier());
    assert.notEqual(rejectedVerifier.status, 200, 'wrong PKCE verifier must be rejected');

    const concurrentCode = await authorize(0, 'finance:read');
    const concurrentExchanges = await Promise.all([
      exchange(concurrentCode.code, concurrentCode.pkceVerifier),
      exchange(concurrentCode.code, concurrentCode.pkceVerifier),
    ]);
    assert.deepEqual(concurrentExchanges.map((response) => response.status).sort(), [200, 400],
      'a one-time authorization code must never issue two tokens concurrently');

    const validFirst = await authorize(0, 'finance:read');
    const firstResponse = await exchange(validFirst.code, validFirst.pkceVerifier);
    assert.equal(firstResponse.status, 200, `Token exchange failure: ${await firstResponse.clone().text()}`);
    const { access_token: firstToken } = await firstResponse.json() as { access_token: string };
    assert.ok(firstToken);
    assert.deepEqual(await getOAuthGrantSubject(firstToken, resource, provider), {
      userId: users[0].id, clientId, scopes: new Set(['finance:read']),
    });
    assert.equal(await getOAuthGrantSubject(firstToken, `${resource}/other`, provider), null);

    const second = await authorize(1, 'finance:write');
    const secondResponse = await exchange(second.code, second.pkceVerifier);
    assert.equal(secondResponse.status, 200, `Second token exchange: ${await secondResponse.clone().text()}`);
    const { access_token: secondToken } = await secondResponse.json() as { access_token: string };
    assert.deepEqual(await getOAuthGrantSubject(secondToken, resource, provider), {
      userId: users[1].id, clientId, scopes: new Set(['finance:write']),
    });
    assert.equal(await revokeClientGrant(users[0].id, clientId), true);
    assert.equal(await getOAuthGrantSubject(firstToken, resource, provider), null);
    assert.notEqual(await getOAuthGrantSubject(secondToken, resource, provider), null);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const user of users) await prisma.user.delete({ where: { id: user.id } });
  }
});
