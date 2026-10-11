/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/http/errors';

import { lastDayOfPreviousMonth, parseUpdateProfile } from './profile';

function status(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.status;
    throw error;
  }
  return null;
}

test('profile patch parses only what was sent', () => {
  assert.deepEqual(parseUpdateProfile({}), {
    salary: undefined,
    salaryReceiveDay: undefined,
    name: undefined,
    notes: undefined,
  });
  const parsed = parseUpdateProfile({
    salary: '5000.50',
    salaryReceiveDay: '5',
    name: ' Ana ',
    notes: '',
  });
  assert.equal(parsed.salary, 5000.5);
  assert.equal(parsed.salaryReceiveDay, 5);
  assert.equal(parsed.name, 'Ana');
  assert.equal(parsed.notes, null);
  assert.equal(parseUpdateProfile({ salary: 0 }).salary, 0);
});

test('profile patch rejects wrong types instead of crashing or clearing', () => {
  assert.equal(
    status(() => parseUpdateProfile({ salary: '10000000000.00' })),
    400,
  );
  assert.equal(
    status(() => parseUpdateProfile({ salaryReceiveDay: 40 })),
    400,
  );
  assert.equal(
    status(() => parseUpdateProfile({ name: '   ' })),
    400,
  );
  assert.equal(
    status(() => parseUpdateProfile({ name: 7 })),
    400,
  );
  assert.equal(
    status(() => parseUpdateProfile({ notes: 7 })),
    400,
  );
});

test('zeroed salary ends on the last day of the previous month', () => {
  assert.equal(
    lastDayOfPreviousMonth(new Date('2026-10-10T12:00:00.000Z')).toISOString(),
    '2026-09-30T12:00:00.000Z',
  );
  assert.equal(
    lastDayOfPreviousMonth(new Date('2026-01-05T12:00:00.000Z')).toISOString(),
    '2025-12-31T12:00:00.000Z',
  );
});
