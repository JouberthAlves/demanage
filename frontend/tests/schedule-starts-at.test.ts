import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScheduleStartsAt,
  formatStartsAtPreview,
} from '@/lib/schedule';

const now = new Date('2026-10-10T15:00:00.000Z');

test('new schedules start at the next occurrence of the chosen month', () => {
  assert.equal(buildScheduleStartsAt(5, 10, { now }), '2026-10-05');
  assert.equal(buildScheduleStartsAt(5, 12, { now }), '2026-12-05');
  assert.equal(buildScheduleStartsAt(5, 3, { now }), '2027-03-05');
});

test('day 31 is clamped into short months', () => {
  assert.equal(buildScheduleStartsAt(31, 2, { now }), '2027-02-28');
});

test('editing keeps an unchanged day and month exactly as stored', () => {
  assert.equal(
    buildScheduleStartsAt(5, 3, { now, previousStartsAt: '2025-03-05' }),
    '2025-03-05',
  );
});

test('editing a changed day or month keeps the stored year', () => {
  assert.equal(
    buildScheduleStartsAt(10, 3, { now, previousStartsAt: '2025-03-05' }),
    '2025-03-10',
  );
  assert.equal(
    buildScheduleStartsAt(5, 6, { now, previousStartsAt: '2025-03-05' }),
    '2025-06-05',
  );
  assert.equal(
    buildScheduleStartsAt(31, 2, { now, previousStartsAt: '2024-03-05' }),
    '2024-02-29',
  );
});

test('an invalid previous start date falls back to the new-schedule rule', () => {
  assert.equal(
    buildScheduleStartsAt(5, 3, { now, previousStartsAt: 'garbage' }),
    '2027-03-05',
  );
  assert.equal(
    buildScheduleStartsAt(5, 3, { now, previousStartsAt: null }),
    '2027-03-05',
  );
});

test('the year rolls over by the São Paulo month, not the UTC one', () => {
  // Oct 31 21:30 in São Paulo is already Nov 1 in UTC.
  const lateOctober = new Date('2026-11-01T00:30:00.000Z');
  assert.equal(buildScheduleStartsAt(5, 10, { now: lateOctober }), '2026-10-05');
});

test('preview formats the stored date in Portuguese', () => {
  assert.equal(formatStartsAtPreview('2026-10-05'), '05 de Outubro de 2026');
  assert.equal(formatStartsAtPreview('nope'), '');
});
