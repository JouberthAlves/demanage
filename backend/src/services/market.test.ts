/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/http/errors';

import { resolveHistoryRange } from './market';

function status(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.status;
    throw error;
  }
  return null;
}

test('default range is today in Sao Paulo, not in UTC', () => {
  // 23:30 em São Paulo (02:30Z do dia seguinte em UTC).
  const now = new Date('2026-10-10T02:30:00.000Z');
  assert.deepEqual(resolveHistoryRange(undefined, undefined, now), {
    from: '2026-10-09',
    to: '2026-10-09',
  });
});

test('explicit ranges pass through and invalid input is a 400, not a 503', () => {
  const now = new Date('2026-10-10T15:00:00.000Z');
  assert.deepEqual(resolveHistoryRange('2026-09-01', '2026-09-30', now), {
    from: '2026-09-01',
    to: '2026-09-30',
  });
  assert.equal(
    status(() => resolveHistoryRange('2026-13-01', '2026-13-02', now)),
    400,
  );
  assert.equal(
    status(() => resolveHistoryRange('2026-09-30', '2026-09-01', now)),
    400,
  );
  assert.equal(
    status(() => resolveHistoryRange('2026-09-01', '2030-01-01', now)),
    400,
  );
  assert.equal(
    status(() => resolveHistoryRange('abc', undefined, now)),
    400,
  );
});
