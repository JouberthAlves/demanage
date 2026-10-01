import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_MONEY_AMOUNT,
  parseMoneyAmount,
  parseOptionalCardLimit,
  parseUniqueDate,
} from '@/lib/validate';

test('money parsing accepts zero only when requested and enforces Decimal(12,2)', () => {
  assert.equal(parseMoneyAmount(0, true), 0);
  assert.equal(parseMoneyAmount(0), null);
  assert.equal(parseMoneyAmount('12.34'), 12.34);
  assert.equal(parseMoneyAmount('12.345', true), null);
  assert.equal(parseMoneyAmount(String(MAX_MONEY_AMOUNT), true), MAX_MONEY_AMOUNT);
  assert.equal(parseMoneyAmount('10000000000.00', true), null);
});

test('card limit parsing preserves null and rejects zero or invalid amounts', () => {
  assert.deepEqual(parseOptionalCardLimit(undefined), {
    value: undefined,
    error: null,
  });
  assert.deepEqual(parseOptionalCardLimit(null), { value: null, error: null });
  assert.equal(parseOptionalCardLimit(0).error, 'Valor deve ser positivo e ter no máximo duas casas decimais');
  assert.equal(parseOptionalCardLimit(100.5).value, 100.5);
});

test('one-off expense dates require a real YYYY-MM-DD calendar date', () => {
  assert.equal(parseUniqueDate('2026-02-28')?.toISOString(), '2026-02-28T12:00:00.000Z');
  assert.equal(parseUniqueDate('2026-02-30'), null);
  assert.equal(parseUniqueDate('2026-2-03'), null);
  assert.equal(parseUniqueDate('2026-09-30T12:00:00Z'), null);
});
