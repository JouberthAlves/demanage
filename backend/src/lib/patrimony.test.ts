import assert from 'node:assert/strict';
import test from 'node:test';

import { addDaysToKey, diffDays } from '@/lib/civil-date';
import { decimal } from '@/lib/decimal';
import { validateHistoryRange } from '@/lib/market/series';
import { MAX_HISTORY_RANGE_DAYS } from '@/lib/market/types';
import {
  buildPatrimonyRows,
  calculationStart,
  createRunningTotal,
  patrimonyToday,
  withTodayPoint,
} from '@/lib/patrimony-calc';

test('patrimony current-day boundary follows the São Paulo civil day', () => {
  assert.equal(
    patrimonyToday(new Date('2026-10-01T01:00:00.000Z'))
      .toISOString()
      .slice(0, 10),
    '2026-09-30',
  );
});

test('a base date older than ten years is clamped, and the clamped range passes the user cap', () => {
  const today = new Date('2026-10-10T12:00:00.000Z');
  const start = calculationStart(new Date('2005-01-01T12:00:00.000Z'), today);
  const startKey = start.toISOString().slice(0, 10);
  assert.equal(diffDays('2026-10-10', startKey) + 1, MAX_HISTORY_RANGE_DAYS);
  assert.doesNotThrow(() =>
    validateHistoryRange(startKey, '2026-10-10', new Date('2026-10-10T15:00:00Z')),
  );
  // A recent base is untouched.
  assert.equal(
    calculationStart(new Date('2026-01-01T12:00:00.000Z'), today).toISOString(),
    '2026-01-01T12:00:00.000Z',
  );
});

test('withTodayPoint returns a new array and never mutates the shared series', () => {
  const shared = [
    { date: '2026-10-08', value: '1' },
    { date: '2026-10-09', value: '2' },
  ];
  const next = withTodayPoint(shared, '2026-10-10', '3');
  assert.equal(shared.length, 2);
  assert.deepEqual(next.map((p) => p.date), ['2026-10-08', '2026-10-09', '2026-10-10']);
  assert.deepEqual(
    withTodayPoint(shared, '2026-10-09', '9').map((p) => p.value),
    ['1', '9'],
  );
});

test('running total reads cumulative steps in one pass', () => {
  const total = createRunningTotal([
    { day: '2026-10-03', delta: decimal('5') },
    { day: '2026-10-01', delta: decimal('10') },
    { day: '2026-10-03', delta: decimal('-2') },
  ]);
  assert.equal(total.at('2026-09-30').toFixed(), '0');
  assert.equal(total.at('2026-10-01').toFixed(), '10');
  assert.equal(total.at('2026-10-02').toFixed(), '10');
  assert.equal(total.at('2026-10-03').toFixed(), '13');
});

function longTimeline(days: number) {
  const baseKey = '2016-10-10';
  const toKey = addDaysToKey(baseKey, days - 1);
  const points = (value: string) =>
    Array.from({ length: days }, (_, index) => ({
      date: addDaysToKey(baseKey, index),
      value,
    }));
  const piggyTransactions = Array.from({ length: 2000 }, (_, index) => ({
    type: index % 3 === 0 ? 'withdraw' : 'deposit',
    amount: '1.00',
    date: new Date(`${addDaysToKey(baseKey, index)}T12:00:00.000Z`),
  }));
  const assetTransactions = Array.from({ length: 2000 }, (_, index) => ({
    asset: index % 2 === 0 ? 'BTC' : 'USD',
    type: 'BUY',
    quantity: '0.001',
    date: new Date(`${addDaysToKey(baseKey, index)}T12:00:00.000Z`),
  }));
  return buildPatrimonyRows({
    storedBaseKey: baseKey,
    calculationBaseKey: baseKey,
    fromKey: baseKey,
    toKey,
    openingCash: decimal('1000'),
    flows: [],
    piggyTransactions,
    assetTransactions,
    btcPoints: points('300000'),
    usdPoints: points('5'),
    cdiPoints: points('0.05').filter((_, index) => index % 7 < 5),
    ipcaPoints: points('1').filter((_, index) => index % 30 === 0),
  });
}

test('a ten-year timeline with thousands of transactions is computed in one pass', () => {
  const started = Date.now();
  const rows = longTimeline(MAX_HISTORY_RANGE_DAYS);
  assert.equal(rows.length, MAX_HISTORY_RANGE_DAYS);
  assert.ok(Date.now() - started < 3000, 'timeline should not be O(days x N)');
  const last = rows.at(-1)!;
  assert.ok(!/e[+-]/.test(JSON.stringify(last)), 'no exponent notation');
});

test('timeline row values: cash, piggy and holdings add up to patrimony', () => {
  const rows = longTimeline(10);
  for (const row of rows) {
    const sum = decimal(row.cashBrl)
      .plus(row.piggyBrl)
      .plus(row.btcBrl)
      .plus(row.usdBrl);
    assert.equal(sum.toFixed(8), decimal(row.patrimonyBrl).toFixed(8));
  }
  assert.equal(rows[0].cashBrl, '1000');
});

test('missing quotes at the base date are reported, not silently zeroed', () => {
  assert.throws(
    () =>
      buildPatrimonyRows({
        storedBaseKey: '2026-01-01',
        calculationBaseKey: '2026-01-01',
        fromKey: '2026-01-01',
        toKey: '2026-01-02',
        openingCash: decimal('0'),
        flows: [],
        piggyTransactions: [],
        assetTransactions: [],
        btcPoints: [],
        usdPoints: [],
        cdiPoints: [],
        ipcaPoints: [],
      }),
    /Histórico de cotação insuficiente/,
  );
});
