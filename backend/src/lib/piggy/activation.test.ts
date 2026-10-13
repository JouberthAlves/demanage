import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interestAccruedThroughOnActivation,
  nextAutoDebitEnabledAt,
} from '@/lib/piggy/activation';

const NOW = new Date('2026-10-10T15:00:00.000Z'); // 12:00 in São Paulo
const OLD = new Date('2026-03-01T12:00:00.000Z');

test('auto-debit enabled date: set on enable, kept while on, cleared when off', () => {
  assert.equal(
    nextAutoDebitEnabledAt({ autoDebit: false, autoDebitEnabledAt: null }, true, NOW),
    NOW,
  );
  assert.equal(
    nextAutoDebitEnabledAt({ autoDebit: true, autoDebitEnabledAt: OLD }, true, NOW),
    OLD,
  );
  assert.equal(
    nextAutoDebitEnabledAt({ autoDebit: true, autoDebitEnabledAt: OLD }, false, NOW),
    null,
  );
  // Re-enabling after a disabled period resets it to now.
  assert.equal(
    nextAutoDebitEnabledAt({ autoDebit: false, autoDebitEnabledAt: null }, true, NOW),
    NOW,
  );
  // Legacy row (on, never stamped) is not cut off by an unrelated edit.
  assert.equal(
    nextAutoDebitEnabledAt({ autoDebit: true, autoDebitEnabledAt: null }, true, NOW),
    null,
  );
});

test('yield activation starts accrual from São Paulo yesterday', () => {
  assert.equal(
    interestAccruedThroughOnActivation(false, true, NOW)?.toISOString(),
    '2026-10-09T12:00:00.000Z',
  );
  // 01:00 São Paulo on the 10th is still the 10th there although UTC is 04:00.
  assert.equal(
    interestAccruedThroughOnActivation(
      false,
      true,
      new Date('2026-10-10T04:00:00.000Z'),
    )?.toISOString(),
    '2026-10-09T12:00:00.000Z',
  );
  // 23:00 São Paulo on the 9th is already the 10th in UTC.
  assert.equal(
    interestAccruedThroughOnActivation(
      false,
      true,
      new Date('2026-10-10T02:00:00.000Z'),
    )?.toISOString(),
    '2026-10-08T12:00:00.000Z',
  );
});

test('yield activation leaves the high-water mark alone otherwise', () => {
  assert.equal(interestAccruedThroughOnActivation(true, true, NOW), null);
  assert.equal(interestAccruedThroughOnActivation(true, false, NOW), null);
  assert.equal(interestAccruedThroughOnActivation(false, false, NOW), null);
});
