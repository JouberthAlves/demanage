import assert from 'node:assert/strict';
import test from 'node:test';

import { loginRedirect } from '../src/lib/login-redirect';

test('login returns to the pending OAuth consent after authenticating', () => {
  assert.equal(
    loginRedirect({ from: { pathname: '/oauth/consent', search: '?uid=abcdefgh12345678' } }),
    '/oauth/consent?uid=abcdefgh12345678',
  );
});

test('login cannot be abused for offsite redirects or arbitrary account URLs', () => {
  for (const state of [
    null, undefined, '/oauth/consent',
    { from: { pathname: '//evil.invalid', search: '?uid=abcdefgh12345678' } },
    { from: { pathname: 'https://evil.invalid', search: '?uid=abcdefgh12345678' } },
    { from: { pathname: '/oauth/consent', search: '?uid=../../evil' } },
    { from: { pathname: '/oauth/consent', search: '?uid=abcdefgh12345678&redirect=https://evil.invalid' } },
    { from: { pathname: '/patrimonio', search: '' } },
  ]) {
    assert.equal(loginRedirect(state), '/');
  }
});
