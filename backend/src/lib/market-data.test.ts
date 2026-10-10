import assert from 'node:assert/strict';
import test from 'node:test';

import { ipcaPeriodRange } from '@/lib/market/providers/ibge';
import { validateHistoryRange } from '@/lib/market/series';
import { MarketDataError } from '@/lib/market/types';

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
      error instanceof MarketDataError &&
      error.message === 'O período máximo é de 10 anos e 10 dias',
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

test('limits SIDRA IPCA queries to reference months that can affect the range', () => {
  const from = new Date('2026-01-01T12:00:00.000Z');
  const to = new Date('2026-09-30T12:00:00.000Z');
  assert.equal(ipcaPeriodRange(from, to), '202512-202608');
  assert.equal(
    ipcaPeriodRange(
      new Date('2026-09-01T12:00:00.000Z'),
      new Date('2026-09-10T12:00:00.000Z'),
    ),
    null,
  );
});
