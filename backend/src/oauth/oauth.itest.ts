import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
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
  const chatgptClientId = 'https://chatgpt.com/oauth/client.json';
  const chatgptJwksUrl = 'https://chatgpt.com/oauth/jwks.json';
  const chatgptCallback = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const chatgptKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwks = {
    keys: [{ ...chatgptKey.publicKey.export({ format: 'jwk' }), kid: 'chatgpt-test-1', use: 'sig', alg: 'RS256' }],
  };
  const cimdMetadata = {
    client_id: chatgptClientId,
    client_name: 'ChatGPT',
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_signing_alg: 'RS256',
    jwks_uri: chatgptJwksUrl,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    redirect_uris: [chatgptCallback],
  };
  const requestedExternal = new Set<string>();
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
    fetch: async (input) => {
      const uri = String(input);
      requestedExternal.add(uri);
      if (uri === chatgptClientId) return Response.json(cimdMetadata);
      if (uri === chatgptJwksUrl) return Response.json(jwks);
      throw new Error(`Unexpected outbound OAuth fetch: ${uri}`);
    },
  });
  app.use(createOAuthDiscoveryRouter(provider));
  app.use('/oauth', createOAuthRouter(provider));
  app.use('/api/oauth', createOAuthRouter(provider));

  async function authorize(userIndex: number, scope: string, oauthClientId = clientId, redirectUri = callback) {
    const user = users[userIndex];
    const jar = new Map<string, string>([['demanage-token', signAuthToken(user.id, user.sessionVersion)]]);
    const pkceVerifier = verifier();
    const url = new URL(`${base}/oauth/auth`);
    url.search = new URLSearchParams({
      client_id: oauthClientId, redirect_uri: redirectUri, response_type: 'code', scope,
      code_challenge: challenge(pkceVerifier), code_challenge_method: 'S256',
      resource, state: `state-${randomUUID()}`,
    }).toString();
    let response = await request(url.toString(), jar);
    const observedSteps: string[] = [];
    for (let attempts = 0; attempts < 8; attempts++) {
      assert.equal(response.status, 303, `OAuth flow unexpected status ${response.status}: ${(await response.clone().text()).slice(0, 300)}`);
      const redirect = response.headers.get('location');
      assert.ok(redirect, 'OAuth flow requires redirect');
      const destination = new URL(redirect, base);
      if (destination.origin === new URL(redirectUri).origin && destination.pathname === new URL(redirectUri).pathname) {
        assert.deepEqual(observedSteps, ['account', 'permissions'], 'OAuth must expose identity then consent as distinct steps');
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
        const info = await details.json() as { csrf: string; scopes: string[]; step: string };
        observedSteps.push(info.step);
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

  async function exchange(code: string, pkceVerifier: string, oauthClientId = clientId, redirectUri = callback, assertion?: string, tokenPath = '/oauth/token') {
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: oauthClientId, redirect_uri: redirectUri, code, code_verifier: pkceVerifier, resource });
    if (assertion) {
      body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
      body.set('client_assertion', assertion);
    }
    return fetch(`${base}${tokenPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  function signedChatgptAssertion(privateKey = chatgptKey.privateKey, overrides: Record<string, unknown> = {}, algorithm = 'RS256') {
    const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: 'JWT', kid: 'chatgpt-test-1' })).toString('base64url');
    const now = Math.floor(Date.now() / 1_000);
    const payload = Buffer.from(JSON.stringify({
      iss: chatgptClientId,
      sub: chatgptClientId,
      aud: `${base}/oauth/token`,
      iat: now,
      exp: now + 60,
      jti: randomUUID(),
      ...overrides,
    })).toString('base64url');
    const content = `${header}.${payload}`;
    return `${content}.${sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64url')}`;
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
      assert.deepEqual(advertised.token_endpoint_auth_methods_supported, ['none', 'private_key_jwt']);
      assert.deepEqual(advertised.token_endpoint_auth_signing_alg_values_supported, ['RS256']);
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

    const chatgptClient = await provider.Client.find(chatgptClientId);
    assert.ok(chatgptClient, 'official ChatGPT CIMD fixture should resolve');
    assert.equal(chatgptClient.clientAuthMethod, 'private_key_jwt');
    assert.equal(chatgptClient.clientAuthSigningAlg, 'RS256');
    assert.equal(chatgptClient.jwksUri, chatgptJwksUrl);

    const badRedirect = new URL(`${base}/oauth/auth`);
    badRedirect.search = new URLSearchParams({
      client_id: chatgptClientId,
      redirect_uri: 'https://chatgpt.com/attacker-callback',
      response_type: 'code',
      scope: 'finance:read',
      resource,
      code_challenge: challenge(verifier()),
      code_challenge_method: 'S256',
    }).toString();
    const rejectedRedirect = await request(badRedirect.toString(), new Map());
    assert.equal(rejectedRedirect.status, 400, 'redirect URI must match the CIMD registration exactly');

    const chatgptMissingAssertion = await authorize(0, 'finance:read', chatgptClientId, chatgptCallback);
    const publicExchange = await exchange(chatgptMissingAssertion.code, chatgptMissingAssertion.pkceVerifier, chatgptClientId, chatgptCallback);
    assert.notEqual(publicExchange.status, 200, 'private_key_jwt must not silently downgrade to public-client auth');

    const chatgptBadSignature = await authorize(0, 'finance:read', chatgptClientId, chatgptCallback);
    const invalidSignature = await exchange(chatgptBadSignature.code, chatgptBadSignature.pkceVerifier, chatgptClientId, chatgptCallback, signedChatgptAssertion(otherKey.privateKey));
    assert.notEqual(invalidSignature.status, 200, 'assertion signed with unknown key must be denied');

    const chatgptBadAudience = await authorize(0, 'finance:read', chatgptClientId, chatgptCallback);
    const invalidAudience = await exchange(chatgptBadAudience.code, chatgptBadAudience.pkceVerifier, chatgptClientId, chatgptCallback, signedChatgptAssertion(chatgptKey.privateKey, { aud: 'https://attacker.example/token' }));
    assert.notEqual(invalidAudience.status, 200, 'incorrect assertion audience must be denied');

    const chatgptBadAlg = await authorize(0, 'finance:read', chatgptClientId, chatgptCallback);
    const invalidAlg = await exchange(chatgptBadAlg.code, chatgptBadAlg.pkceVerifier, chatgptClientId, chatgptCallback, signedChatgptAssertion(chatgptKey.privateKey, {}, 'PS256'));
    assert.notEqual(invalidAlg.status, 200, 'algorithm other than RS256 must be denied');

    const chatgptValid = await authorize(0, 'finance:read', chatgptClientId, chatgptCallback);
    const tokenFromChatgpt = await exchange(chatgptValid.code, chatgptValid.pkceVerifier, chatgptClientId, chatgptCallback, signedChatgptAssertion());
    assert.equal(tokenFromChatgpt.status, 200, `ChatGPT private_key_jwt exchange: ${await tokenFromChatgpt.clone().text()}`);
    const { access_token: chatgptToken } = await tokenFromChatgpt.json() as { access_token: string };
    assert.deepEqual(await getOAuthGrantSubject(chatgptToken, resource, provider), {
      userId: users[0].id, clientId: chatgptClientId, scopes: new Set(['finance:read']),
    });

    // The browser sees /api/oauth/token behind nginx, while the old internal
    // /oauth/token mount generates the wrong accepted private_key_jwt audience.
    const publicAuth = await authorize(0, 'finance:read', chatgptClientId, chatgptCallback);
    const publicAudienceExchange = await exchange(
      publicAuth.code, publicAuth.pkceVerifier, chatgptClientId, chatgptCallback,
      signedChatgptAssertion(chatgptKey.privateKey, { aud: `${base}/api/oauth/token` }),
      '/api/oauth/token',
    );
    assert.equal(publicAudienceExchange.status, 200, 'Signed public token audience must succeed on the public token path');

    const duplicateAssertion = signedChatgptAssertion();
    const signedOnce = await authorize(0, 'finance:read', chatgptClientId, chatgptCallback);
    const acceptedAssertion = await exchange(signedOnce.code, signedOnce.pkceVerifier, chatgptClientId, chatgptCallback, duplicateAssertion);
    assert.equal(acceptedAssertion.status, 200);
    const signedTwice = await authorize(0, 'finance:read', chatgptClientId, chatgptCallback);
    const replayedAssertion = await exchange(signedTwice.code, signedTwice.pkceVerifier, chatgptClientId, chatgptCallback, duplicateAssertion);
    assert.notEqual(replayedAssertion.status, 200, 'JWT client assertion jti must be one-time use');

    assert.deepEqual([...requestedExternal].sort(), [chatgptClientId, chatgptJwksUrl].sort(),
      'private_key_jwt fetches only the exact trusted CIMD document and JWKS');

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
