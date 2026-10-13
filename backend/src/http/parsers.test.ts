/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from './errors';
import {
  parseAmount,
  parseCardExpiry,
  parseDayOfMonth,
  parseIsoDate,
  parseMonthKey,
  parseOneOf,
  parseOptionalId,
  parseOptionalIsoDate,
  parseRequiredText,
} from './parsers';

function status(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.status;
    throw error;
  }
  return null;
}

test('day of month accepts integers and numeric strings only', () => {
  assert.equal(parseDayOfMonth(undefined, 'm'), undefined);
  assert.equal(parseDayOfMonth(null, 'm'), null);
  assert.equal(parseDayOfMonth('', 'm'), null);
  assert.equal(parseDayOfMonth(5, 'm'), 5);
  assert.equal(parseDayOfMonth('31', 'm'), 31);
  for (const bad of [0, 32, 1.5, '12abc', true, [], '-1']) {
    assert.equal(
      status(() => parseDayOfMonth(bad, 'm')),
      400,
      String(bad),
    );
  }
});

test('ISO dates are strict calendar dates at UTC midnight', () => {
  assert.equal(
    parseIsoDate('2026-02-28')?.toISOString(),
    '2026-02-28T00:00:00.000Z',
  );
  assert.equal(
    parseIsoDate('2028-02-29')?.toISOString(),
    '2028-02-29T00:00:00.000Z',
  );
  assert.equal(parseIsoDate('2026-02-30'), null);
  assert.equal(parseIsoDate('2026-2-3'), null);
  assert.equal(parseIsoDate('2026-02-28T00:00:00Z'), null);
  assert.equal(parseIsoDate(20260228), null);
  assert.equal(parseOptionalIsoDate(undefined, 'm'), undefined);
  assert.equal(parseOptionalIsoDate('', 'm'), null);
  assert.equal(
    status(() => parseOptionalIsoDate('2026-02-30', 'm')),
    400,
  );
});

test('card expiry covers the whole Sao Paulo day and rejects impossible dates', () => {
  assert.equal(parseCardExpiry(undefined), undefined);
  assert.equal(parseCardExpiry(null), null);
  assert.equal(
    parseCardExpiry('2026-12-31')?.toISOString(),
    '2027-01-01T02:59:59.999Z',
  );
  // Formato legado do frontend: instante completo com fuso.
  assert.equal(
    parseCardExpiry('2027-03-31T23:59:59.999-03:00')?.toISOString(),
    '2027-04-01T02:59:59.999Z',
  );
  assert.equal(
    status(() => parseCardExpiry('2026-02-30')),
    400,
  );
  assert.equal(
    status(() => parseCardExpiry('2026-02-30T10:00:00Z')),
    400,
  );
  assert.equal(
    status(() => parseCardExpiry('not a date')),
    400,
  );
  assert.equal(
    status(() => parseCardExpiry(123)),
    400,
  );
});

test('month keys, enums, ids and text', () => {
  assert.equal(parseMonthKey('2026-09'), '2026-09');
  assert.equal(parseMonthKey('2026-13'), null);
  assert.equal(parseMonthKey(202609), null);
  assert.equal(parseOneOf('a', ['a', 'b'] as const, 'm'), 'a');
  assert.equal(
    status(() => parseOneOf('c', ['a', 'b'] as const, 'm')),
    400,
  );
  assert.equal(parseOptionalId(undefined, 'm'), undefined);
  assert.equal(parseOptionalId('', 'm'), null);
  assert.equal(parseOptionalId('abc', 'm'), 'abc');
  assert.equal(
    status(() => parseOptionalId(7, 'm')),
    400,
  );
  assert.equal(parseRequiredText('  Olá  ', 10, 'm'), 'Olá');
  assert.equal(
    status(() => parseRequiredText('   ', 10, 'm')),
    400,
  );
  assert.equal(
    status(() => parseRequiredText({}, 10, 'm')),
    400,
  );
});

test('amounts follow the money rules with an HTTP error', () => {
  assert.equal(parseAmount('10.5'), 10.5);
  assert.equal(parseAmount(0, { allowZero: true }), 0);
  assert.equal(
    status(() => parseAmount(0)),
    400,
  );
  assert.equal(
    status(() => parseAmount('1.234')),
    400,
  );
  assert.equal(
    status(() => parseAmount({})),
    400,
  );
});
