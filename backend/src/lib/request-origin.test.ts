import assert from 'node:assert/strict';
import test from 'node:test';

import { isAllowedBrowserOrigin } from '@/lib/request-origin';

test('trusted production origin matches the configured application origin', () => {
  assert.equal(
    isAllowedBrowserOrigin(
      'https://finance.example.com',
      'https://finance.example.com/',
      'production',
    ),
    true,
  );
});

test('production does not trust another host or a URL with a path', () => {
  assert.equal(
    isAllowedBrowserOrigin(
      'https://attacker.example',
      'https://finance.example.com',
      'production',
    ),
    false,
  );
  assert.equal(
    isAllowedBrowserOrigin(
      'https://finance.example.com/path',
      'https://finance.example.com',
      'production',
    ),
    false,
  );
});

test('development keeps the existing loopback, private IPv4, and .local origins', () => {
  assert.equal(
    isAllowedBrowserOrigin('http://127.0.0.1:5180', undefined, 'development'),
    true,
  );
  assert.equal(
    isAllowedBrowserOrigin(
      'http://192.168.1.20:5180',
      undefined,
      'development',
    ),
    true,
  );
  assert.equal(
    isAllowedBrowserOrigin(
      'http://laptop.local:5180',
      undefined,
      'development',
    ),
    true,
  );
  assert.equal(
    isAllowedBrowserOrigin(
      'https://attacker.example',
      undefined,
      'development',
    ),
    false,
  );
});
