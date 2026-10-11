import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listDueClosingDates,
  nextClosingOnOrAfter,
} from '@/lib/billing/calendar';
import { dayKeyInSaoPaulo } from '@/lib/civil-date';

test('due closing dates are returned only through the requested cutoff', () => {
  assert.deepEqual(
    listDueClosingDates(
      5,
      new Date('2026-09-01T12:00:00.000Z'),
      new Date('2026-10-04T12:00:00.000Z'),
    ).map((date) => date.toISOString().slice(0, 10)),
    ['2026-09-05'],
  );
});

test('closing day 31 clamps to the last day of short months', () => {
  assert.deepEqual(
    listDueClosingDates(
      31,
      new Date('2026-01-31T12:00:00.000Z'),
      new Date('2026-04-30T12:00:00.000Z'),
    ).map((date) => date.toISOString().slice(0, 10)),
    ['2026-02-28', '2026-03-31', '2026-04-30'],
  );
});

test('next closing on or after a day', () => {
  assert.equal(nextClosingOnOrAfter(5, '2026-09-05', '2026-09-20'), '2026-10-05');
  assert.equal(nextClosingOnOrAfter(5, '2026-09-05', '2026-10-05'), '2026-10-05');
});

test('timestamp boundaries use the São Paulo civil date', () => {
  assert.equal(
    dayKeyInSaoPaulo(new Date('2026-10-01T02:30:00.000Z')),
    '2026-09-30',
  );
});
