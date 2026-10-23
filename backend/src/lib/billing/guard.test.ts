import assert from 'node:assert/strict';
import test from 'node:test';

import type { BillableExpense } from '@/lib/billing/charges';
import { cardsWithUnclosedBilling } from '@/lib/billing/guard';
import { type BillingCardState, planCardBilling } from '@/lib/billing/plan';

const at = (day: string) => new Date(`${day}T12:00:00.000Z`);

function card(values: Partial<BillingCardState> = {}): BillingCardState {
  return {
    id: 'card-1',
    closingDay: 31,
    pendingClosingDay: null,
    pendingClosingDaySetAt: null,
    minimumNextClosingOn: null,
    lastInvoicedOn: null,
    lastBillingProcessedAt: null,
    createdAt: at('2026-08-01'),
    ...values,
  };
}

function recurring(amount: string, cardAmount = amount): BillableExpense {
  return {
    amount,
    cardId: null,
    isInvoice: false,
    frequency: 'mensal',
    startsAt: at('2026-08-01'),
    endsAt: null,
    occurredAt: null,
    createdAt: at('2026-08-01'),
    splits: [
      { kind: 'card', cardId: 'card-1', amount: cardAmount },
      {
        kind: 'pix',
        cardId: null,
        amount: String(Number(amount) - Number(cardAmount)),
      },
    ],
  };
}

test('F02: overdue August/September obligations must close before October amount and split edit', () => {
  const originalCard = card();
  const original = recurring('100', '60');

  // The broken path would use the October amount/split for every old closing.
  const unguarded = planCardBilling(
    originalCard,
    [recurring('200', '150')],
    at('2026-10-22'),
    at('2026-10-23'),
  );
  assert.deepEqual(
    unguarded.invoices.map((invoice) => invoice.amount.toFixed(2)),
    ['150.00', '150.00'],
  );

  // Before mutation, caller must refuse edits on cards with overdue closes.
  assert.deepEqual(cardsWithUnclosedBilling([originalCard], at('2026-10-23')), [
    'card-1',
  ]);

  const catchUp = planCardBilling(
    originalCard,
    [original],
    at('2026-10-22'),
    at('2026-10-23'),
  );
  assert.deepEqual(
    catchUp.invoices.map((invoice) => [
      invoice.closingOn.toISOString().slice(0, 10),
      invoice.amount.toFixed(2),
    ]),
    [
      ['2026-08-31', '60.00'],
      ['2026-09-30', '60.00'],
    ],
  );

  const updatedCard = card(catchUp.cardUpdate ?? {});
  assert.deepEqual(
    cardsWithUnclosedBilling([updatedCard], at('2026-10-23')),
    [],
  );
  const october = planCardBilling(
    updatedCard,
    [recurring('200', '150')],
    at('2026-10-31'),
    at('2026-11-01'),
  );
  assert.deepEqual(
    october.invoices.map((invoice) => invoice.amount.toFixed(2)),
    ['150.00'],
  );
});

test('pending closing-day changes and 28-day minimum are evaluated by the planner', () => {
  const changed = card({
    pendingClosingDay: 5,
    pendingClosingDaySetAt: at('2026-08-10'),
  });
  assert.deepEqual(cardsWithUnclosedBilling([changed], at('2026-09-01')), [
    'card-1',
  ]);
  const first = planCardBilling(
    changed,
    [],
    at('2026-08-31'),
    at('2026-09-01'),
  );
  assert.deepEqual(
    cardsWithUnclosedBilling([card(first.cardUpdate ?? {})], at('2026-09-10')),
    [],
  );
});
