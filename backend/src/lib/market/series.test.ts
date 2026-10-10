import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cloneSeries,
  completedPointsOnly,
  createPointCursor,
  dedupePoints,
  isFreshHistory,
  lastCompletedDayKey,
  lastWeekdayOnOrBefore,
  validateHistoryRange,
} from '@/lib/market/series';
import { MarketDataError } from '@/lib/market/types';

// Friday 2026-10-09 evening in Sao Paulo (2026-10-09T21:00Z = 18:00 BRT).
const friday = new Date('2026-10-09T21:00:00.000Z');
// Monday 2026-10-12 noon BRT.
const monday = new Date('2026-10-12T15:00:00.000Z');

const pt = (date: string, value = '5') => ({ date, value });

test('the last completed day is yesterday in Sao Paulo', () => {
  assert.equal(lastCompletedDayKey(friday), '2026-10-08');
  assert.equal(lastCompletedDayKey(new Date('2026-10-10T02:00:00Z')), '2026-10-08');
});

test('weekends roll back to Friday', () => {
  assert.equal(lastWeekdayOnOrBefore('2026-10-10'), '2026-10-09');
  assert.equal(lastWeekdayOnOrBefore('2026-10-11'), '2026-10-09');
  assert.equal(lastWeekdayOnOrBefore('2026-10-09'), '2026-10-09');
});

test('the still-open day is never stored', () => {
  const points = [pt('2026-10-07'), pt('2026-10-08'), pt('2026-10-09'), pt('2026-10-10')];
  assert.deepEqual(
    completedPointsOnly(points, friday).map((p) => p.date),
    ['2026-10-07', '2026-10-08'],
  );
});

test('a series ending two days before `to` is no longer considered fresh', () => {
  // Old rule accepted anything within 3 days of `to`.
  const stale = [pt('2026-09-01'), pt('2026-10-06')];
  assert.equal(isFreshHistory(stale, '2026-09-01', '2026-10-09', { now: friday }), false);
  const fresh = [pt('2026-09-01'), pt('2026-10-08')];
  assert.equal(isFreshHistory(fresh, '2026-09-01', '2026-10-09', { now: friday }), true);
});

test('business-day series are fresh on Monday when they end on Friday', () => {
  const upToFriday = [pt('2026-09-01'), pt('2026-10-09')];
  assert.equal(
    isFreshHistory(upToFriday, '2026-09-01', '2026-10-12', {
      now: monday,
      businessDaysOnly: true,
    }),
    true,
  );
  // 7-day (BTC) series must have Sunday's candle.
  assert.equal(
    isFreshHistory(upToFriday, '2026-09-01', '2026-10-12', { now: monday }),
    false,
  );
  assert.equal(
    isFreshHistory([...upToFriday, pt('2026-10-11')], '2026-09-01', '2026-10-12', {
      now: monday,
    }),
    true,
  );
});

test('freshness also requires coverage from the requested start', () => {
  assert.equal(
    isFreshHistory([pt('2026-09-20'), pt('2026-10-08')], '2026-09-01', '2026-10-09', {
      now: friday,
    }),
    false,
  );
  assert.equal(isFreshHistory([], '2026-09-01', '2026-10-09', { now: friday }), false);
});

test('a range with no completed day yet is trivially complete (empty)', () => {
  assert.equal(isFreshHistory([], '2026-10-09', '2026-10-09', { now: friday }), true);
});

test('only the USER range is capped; look-back padding is not', () => {
  const now = new Date('2026-10-10T15:00:00Z');
  // Inclusive 3663 days passes, 3664 fails with the 10y+10d message.
  assert.doesNotThrow(() => validateHistoryRange('2016-10-09', '2026-10-09', now));
  assert.doesNotThrow(() => validateHistoryRange('2016-09-29', '2026-10-09', now));
  assert.throws(
    () => validateHistoryRange('2016-09-28', '2026-10-09', now),
    (error: unknown) =>
      error instanceof MarketDataError &&
      error.message === 'O período máximo é de 10 anos e 10 dias',
  );
});

test('range validation uses the Sao Paulo day and strict dates', () => {
  assert.throws(
    () => validateHistoryRange('2026-10-01', '2026-10-10', new Date('2026-10-10T01:00:00Z')),
    /Data futura/,
  );
  assert.doesNotThrow(() =>
    validateHistoryRange('2026-10-01', '2026-10-10', new Date('2026-10-10T04:00:00Z')),
  );
  assert.throws(() => validateHistoryRange('2026-02-30', '2026-03-01'), /Data inválida/);
  assert.throws(() => validateHistoryRange('2026-03-02', '2026-03-01'), /Período inválido/);
});

test('cloneSeries and dedupe never share point objects', () => {
  const original = { provider: 'p', stale: false, points: [pt('2026-10-01')] };
  const copy = cloneSeries(original);
  copy.points[0].value = '99';
  copy.points.push(pt('2026-10-02'));
  assert.equal(original.points[0].value, '5');
  assert.equal(original.points.length, 1);
  assert.deepEqual(
    dedupePoints([pt('2026-10-02', '1'), pt('2026-10-01', '2'), pt('2026-10-02', '3')]),
    [pt('2026-10-01', '2'), pt('2026-10-02', '3')],
  );
});

test('point cursor finds the latest point on or before a day in one pass', () => {
  const cursor = createPointCursor([pt('2026-10-01', '1'), pt('2026-10-05', '5')]);
  assert.equal(cursor.at('2026-09-30'), null);
  assert.equal(cursor.at('2026-10-03')?.value, '1');
  assert.equal(cursor.at('2026-10-05')?.value, '5');
  assert.equal(cursor.at('2026-10-09')?.value, '5');
});
