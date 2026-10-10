import { AxiosError } from 'axios';
import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldRetryReadRequest } from '@/lib/query-retry';

function responseError(status: number) {
  const error = new AxiosError('Request failed');
  error.response = { status } as AxiosError['response'];
  return error;
}

test('do not retry authentication, not-found or rate-limit errors', () => {
  for (const status of [400, 401, 403, 404, 429]) {
    assert.equal(shouldRetryReadRequest(0, responseError(status)), false);
  }
});

test('retry transient failures at most once', () => {
  assert.equal(shouldRetryReadRequest(0, responseError(500)), true);
  assert.equal(shouldRetryReadRequest(1, responseError(500)), false);
  assert.equal(shouldRetryReadRequest(0, new Error('Network error')), true);
  assert.equal(shouldRetryReadRequest(1, new Error('Network error')), false);
});
