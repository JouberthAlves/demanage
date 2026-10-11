import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDaysToKey,
  addMonthsClamped,
  clampDayToMonth,
  dayKeyInSaoPaulo,
  dayKeyOfDate,
  diffDays,
  isValidDayKey,
  lastDayOfMonth,
  monthBounds,
  monthKey,
  parseCivilDate,
  todayInSaoPaulo,
  weekdayOfKey,
} from '@/lib/civil-date';
import { parseUniqueDate } from '@/lib/validate';

test('strict parser rejects impossible and malformed dates', () => {
  for (const bad of [
    '2026-02-30',
    '2026-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-1-1',
    '26-01-01',
    '2026-01-01T00:00:00Z',
    ' 2026-01-01',
    '',
    null,
    undefined,
    20260101,
  ]) {
    assert.equal(parseCivilDate(bad), null, String(bad));
    assert.equal(isValidDayKey(bad), false, String(bad));
  }
  assert.notEqual(parseCivilDate('2028-02-29'), null);
});

test('conventions are explicit: noon vs midnight UTC', () => {
  assert.equal(parseCivilDate('2026-09-05')?.toISOString(), '2026-09-05T12:00:00.000Z');
  assert.equal(
    parseCivilDate('2026-09-05', 'midnight')?.toISOString(),
    '2026-09-05T00:00:00.000Z',
  );
});

test('every legacy parser delegates to the strict one and keeps its convention', () => {
  assert.equal(parseUniqueDate('2026-02-30'), null);
  assert.equal(parseUniqueDate('2026-09-05')?.toISOString(), '2026-09-05T12:00:00.000Z');
});

test('Sao Paulo civil day around midnight UTC', () => {
  assert.equal(dayKeyInSaoPaulo(new Date('2026-10-01T02:59:59Z')), '2026-09-30');
  assert.equal(dayKeyInSaoPaulo(new Date('2026-10-01T03:00:00Z')), '2026-10-01');
  assert.equal(
    todayInSaoPaulo(new Date('2026-10-01T01:00:00Z')).toISOString(),
    '2026-09-30T12:00:00.000Z',
  );
});

test('day arithmetic is timezone free', () => {
  assert.equal(addDaysToKey('2026-02-28', 1), '2026-03-01');
  assert.equal(addDaysToKey('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysToKey('2026-01-01', -1), '2025-12-31');
  assert.equal(diffDays('2026-03-01', '2026-02-01'), 28);
  assert.equal(weekdayOfKey('2026-08-31'), 1);
});

test('month helpers', () => {
  assert.equal(lastDayOfMonth(2026, 1), 28);
  assert.equal(lastDayOfMonth(2028, 1), 29);
  assert.equal(clampDayToMonth(2026, 3, 31), 30);
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsClamped('2026-11-30', 3), '2027-02-28');
  assert.equal(monthKey('2026-09-05'), '2026-09');
  assert.equal(monthKey(new Date('2026-09-05T12:00:00Z')), '2026-09');
  const bounds = monthBounds(2026, 8);
  assert.equal(bounds.startKey, '2026-09-01');
  assert.equal(bounds.endKey, '2026-09-30');
  assert.equal(dayKeyOfDate(bounds.end), '2026-09-30');
});
