import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeRequestTargetForLog } from './request-logger';

test('request logs never expose OAuth codes or query credentials', () => {
  assert.equal(
    sanitizeRequestTargetForLog('/oauth/callback?code=secret&state=nonce'),
    '/oauth/callback',
  );
  assert.equal(
    sanitizeRequestTargetForLog('/oauth/authorize?redirect_uri=https%3A%2F%2Fexample.com&client_id=xyz'),
    '/oauth/authorize',
  );
  assert.equal(sanitizeRequestTargetForLog('/mcp?access_token=secret'), '/mcp');
  assert.equal(sanitizeRequestTargetForLog('/health'), '/health');
  assert.equal(sanitizeRequestTargetForLog('/auth/reset#fragment'), '/auth/reset');
});
