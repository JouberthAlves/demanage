import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const consentPage = readFileSync(new URL('../src/pages/oauth-consent-page.tsx', import.meta.url), 'utf8');

test('OAuth consent overrides no-referrer only for its browser form submission', () => {
  assert.match(consentPage, /<meta name='referrer' content='same-origin'\s*\/>/);
  assert.match(consentPage, /<form method='post'/);
});
