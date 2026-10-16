/* eslint-disable simple-import-sort/imports -- Set DATABASE_URL before the provider imports Prisma. */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Client } from 'oidc-provider';

import { allowedCimdHosts, isAllowedCimdClient, isAllowedCimdClientId } from './provider';

test('CIMD trusts the exact ChatGPT HTTPS hostname, without wildcard fetch trust', () => {
  const hosts = allowedCimdHosts();
  assert.equal(hosts.has('chatgpt.com'), true);
  assert.equal(isAllowedCimdClientId('https://chatgpt.com/oauth/client.json', hosts), true);
  assert.equal(isAllowedCimdClientId('https://CHATGPT.COM/oauth/client.json', hosts), true);
  for (const url of [
    'http://chatgpt.com/oauth/client.json',
    'https://chatgpt.com.evil.example/oauth/client.json',
    'https://private.chatgpt.com/oauth/client.json',
    'https://chatgpt.com:444/oauth/client.json',
    'https://hacker@chatgpt.com/oauth/client.json',
    'https://chatgpt.com/oauth/client.json#fragment',
    'https://127.0.0.1/oauth/client.json',
    'https://example.org/client.json',
  ]) {
    assert.equal(isAllowedCimdClientId(url, hosts), false, `unexpected CIMD allow: ${url}`);
  }
  const extra = allowedCimdHosts(['my-agent.example']);
  assert.equal(isAllowedCimdClientId('https://my-agent.example/client.json', extra), true);
  assert.equal(isAllowedCimdClientId('https://unapproved.example/client.json', extra), false);
});

test('CIMD private_key_jwt only trusts the exact ChatGPT JWKS, RS256, and registered HTTPS redirects', () => {
  const hosts = allowedCimdHosts();
  const safe = {
    clientId: 'https://chatgpt.com/oauth/client.json',
    tokenEndpointAuthMethod: 'private_key_jwt',
    tokenEndpointAuthSigningAlg: 'RS256',
    jwksUri: 'https://chatgpt.com/oauth/jwks.json',
    jwks: undefined,
    redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
  };
  const accepted = (values: Record<string, unknown> = {}) =>
    isAllowedCimdClient({ ...safe, ...values } as unknown as Client, hosts);

  assert.equal(accepted(), true);
  for (const metadata of [
    { jwksUri: 'https://attacker.invalid/oauth/jwks.json' },
    { jwksUri: 'https://evil.chatgpt.com/oauth/jwks.json' },
    { jwksUri: 'https://chatgpt.com/oauth/other-keys.json' },
    { jwksUri: 'http://chatgpt.com/oauth/jwks.json' },
    { jwksUri: 'https://chatgpt.com/oauth/jwks.json?alternate=true' },
    { jwks: { keys: [{ kty: 'RSA' }] } },
    { clientId: 'https://chatgpt.com/oauth/another-client.json' },
    { tokenEndpointAuthSigningAlg: 'PS256' },
    { tokenEndpointAuthSigningAlg: 'none' },
    { tokenEndpointAuthMethod: 'client_secret_post' },
    { redirectUris: ['https://attacker.example/callback'] },
    { redirectUris: ['https://chatgpt.com.evil.invalid/callback'] },
    { redirectUris: ['http://chatgpt.com/callback'] },
    { redirectUris: [] },
    { grantTypes: ['client_credentials'] },
    { responseTypes: ['token'] },
  ]) {
    assert.equal(accepted(metadata), false, `unsafe client metadata must be denied: ${JSON.stringify(metadata)}`);
  }
  assert.equal(accepted({ tokenEndpointAuthMethod: 'none' }), true,
    'allowlisted public CIMD clients remain compatible with PKCE');
  assert.equal(accepted({ clientId: 'https://unknown.example/client.json', tokenEndpointAuthMethod: 'none' }), false);
});
