import assert from 'node:assert/strict';
import test from 'node:test';

import { MarketDataError, validateHistoryRange } from '@/lib/market-data';

const now = new Date('2026-09-29T12:00:00.000Z');

test('accepts valid market-history ranges up to ten years', () => {
  const range = validateHistoryRange('2016-09-29', '2026-09-29', now);
  assert.equal(range.from.toISOString().slice(0, 10), '2016-09-29');
  assert.equal(range.to.toISOString().slice(0, 10), '2026-09-29');
});

test('rejects market-history ranges beyond ten years plus provider look-back', () => {
  assert.throws(
    () => validateHistoryRange('2016-09-18', '2026-09-29', now),
    (error: unknown) =>
      error instanceof MarketDataError && error.message.includes('10 anos'),
  );
});

test('rejects future and invalid calendar dates', () => {
  assert.throws(
    () => validateHistoryRange('2026-09-01', '2026-09-30', now),
    /Data futura não permitida/,
  );
  assert.throws(
    () => validateHistoryRange('2026-02-31', '2026-03-01', now),
    /Data inválida/,
  );
});
