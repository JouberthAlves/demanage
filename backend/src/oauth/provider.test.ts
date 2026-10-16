/* eslint-disable simple-import-sort/imports -- Set DATABASE_URL before the provider imports Prisma. */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { allowedCimdHosts, isAllowedCimdClientId } from './provider';

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
