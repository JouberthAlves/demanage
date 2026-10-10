import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type BillableExpense,
  chargeAmountForClosing,
  chargeOccurrences,
  countMonthlyOccurrences,
  countWeeklyOccurrences,
  lateOneOffsTotalForClosing,
  splitShareFor,
} from '@/lib/billing/charges';

function expense(values: Partial<BillableExpense>): BillableExpense {
  return {
    amount: '25',
    cardId: 'card-1',
    isInvoice: false,
    frequency: 'unica',
    startsAt: null,
    endsAt: null,
    occurredAt: new Date('2026-09-01T12:00:00.000Z'),
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    archivedAt: null,
    splits: [],
    ...values,
  };
}

const at = (day: string) => new Date(`${day}T12:00:00.000Z`);

test('first cycle includes a one-off purchase on the card creation day', () => {
  assert.equal(
    chargeAmountForClosing(
      expense({}),
      'card-1',
      at('2026-09-05'),
      at('2026-09-01'),
      true,
    ),
    25,
  );
});

test('a one-off on the prior closing date is not billed in the next cycle', () => {
  assert.equal(
    chargeAmountForClosing(
      expense({ occurredAt: at('2026-09-05') }),
      'card-1',
      at('2026-10-05'),
      at('2026-09-05'),
    ),
    0,
  );
});

test('a one-off entered after the prior close is billed once as a late adjustment', () => {
  const latePurchase = expense({
    occurredAt: at('2026-09-05'),
    createdAt: at('2026-09-07'),
  });
  assert.equal(
    lateOneOffsTotalForClosing(
      [latePurchase],
      'card-1',
      at('2026-09-05'),
      at('2026-09-06'),
    ),
    25,
  );
  assert.equal(
    lateOneOffsTotalForClosing(
      [latePurchase],
      'card-1',
      at('2026-09-05'),
      at('2026-09-08'),
    ),
    0,
  );
});

test('weekly charges count the real weekday occurrences: 5 Mondays bill 5x', () => {
  const monday = expense({
    frequency: 'semanal',
    amount: '25',
    startsAt: at('2026-08-31'),
  });
  // Mondays in (2026-08-31, 2026-10-05]: Sep 7, 14, 21, 28 and Oct 5.
  assert.equal(
    chargeAmountForClosing(monday, 'card-1', at('2026-10-05'), at('2026-08-31')),
    125,
  );
  // Mondays in (2026-10-05, 2026-11-05]: Oct 12, 19, 26 and Nov 2.
  assert.equal(
    chargeAmountForClosing(monday, 'card-1', at('2026-11-05'), at('2026-10-05')),
    100,
  );
});

test('weekly counting honours startsAt, endsAt and the archive day', () => {
  assert.equal(countWeeklyOccurrences('2026-09-14', '2026-09-01', '2026-09-30'), 3);
  assert.equal(countWeeklyOccurrences('2026-08-31', '2026-09-08', '2026-09-13'), 0);
  const ended = expense({
    frequency: 'semanal',
    startsAt: at('2026-08-31'),
    endsAt: at('2026-09-14'),
  });
  assert.equal(
    chargeOccurrences(ended, {
      periodStartKey: '2026-08-31',
      closingKey: '2026-10-05',
      includePeriodStart: false,
    }),
    2,
  );
});

test('monthly charges bill every occurrence inside a long (skipped-closing) cycle', () => {
  const monthly = expense({
    frequency: 'mensal',
    amount: '40',
    startsAt: at('2026-08-01'),
  });
  // Normal cycle: one occurrence.
  assert.equal(
    chargeAmountForClosing(monthly, 'card-1', at('2026-10-05'), at('2026-09-05')),
    40,
  );
  // A 28-day rule skipped a closing: (Aug 31, Oct 5] spans Sep 1 and Oct 1.
  assert.equal(
    chargeAmountForClosing(monthly, 'card-1', at('2026-10-05'), at('2026-08-31')),
    80,
  );
});

test('monthly day 31 is clamped to the month end', () => {
  assert.equal(countMonthlyOccurrences('2026-01-31', '2026-02-01', '2026-02-28'), 1);
  assert.equal(countMonthlyOccurrences('2026-01-31', '2026-02-01', '2026-04-30'), 3);
  assert.equal(countMonthlyOccurrences('2026-03-10', '2026-01-01', '2026-03-09'), 0);
});

test('archiving preserves one-off card purchases but stops later recurring charges', () => {
  const archivedRecurring = expense({
    frequency: 'mensal',
    occurredAt: null,
    startsAt: at('2026-09-01'),
    archivedAt: at('2026-09-20'),
  });
  const archivedOneOff = expense({
    occurredAt: at('2026-09-10'),
    archivedAt: at('2026-09-20'),
  });
  assert.equal(
    chargeAmountForClosing(
      archivedRecurring,
      'card-1',
      at('2026-10-05'),
      at('2026-09-05'),
    ),
    0,
  );
  assert.equal(
    chargeAmountForClosing(
      archivedOneOff,
      'card-1',
      at('2026-10-05'),
      at('2026-09-05'),
    ),
    25,
  );
});

test('invoices are never charged on a card', () => {
  assert.equal(
    chargeOccurrences(expense({ isInvoice: true }), {
      periodStartKey: '2026-08-31',
      closingKey: '2026-10-05',
      includePeriodStart: false,
    }),
    0,
  );
});

test('splitShareFor is the single split rule for card, pix and cash', () => {
  const split = expense({
    amount: '19.99',
    cardId: null,
    splits: [
      { kind: 'card', cardId: 'card-1', amount: '10.00' },
      { kind: 'pix', cardId: null, amount: '9.99' },
    ],
  });
  assert.equal(splitShareFor(split, { kind: 'card', cardId: 'card-1' }).toFixed(2), '10.00');
  assert.equal(splitShareFor(split, { kind: 'card', cardId: 'card-2' }).toFixed(2), '0.00');
  assert.equal(splitShareFor(split, { kind: 'pix' }).toFixed(2), '9.99');

  const legacyCard = expense({ amount: '30', cardId: 'card-1', splits: [] });
  assert.equal(splitShareFor(legacyCard, { kind: 'card', cardId: 'card-1' }).toFixed(2), '30.00');
  assert.equal(splitShareFor(legacyCard, { kind: 'cash' }).toFixed(2), '0.00');

  const cash = expense({ amount: '12.50', cardId: null, splits: [] });
  assert.equal(splitShareFor(cash, { kind: 'cash' }).toFixed(2), '12.50');
});

test('card amounts are summed in decimal, not floating point', () => {
  const total = [1, 2, 3].reduce(
    (sum, _, index) =>
      sum +
      chargeAmountForClosing(
        expense({ amount: '0.1', occurredAt: at(`2026-09-0${index + 1}`) }),
        'card-1',
        at('2026-09-30'),
        at('2026-08-31'),
      ),
    0,
  );
  assert.equal(Math.round(total * 100), 30);
  assert.equal(
    chargeAmountForClosing(expense({ amount: '0.1' }), 'card-1', at('2026-09-30'), at('2026-08-31')),
    0.1,
  );
});
