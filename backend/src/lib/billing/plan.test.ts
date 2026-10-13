import assert from 'node:assert/strict';
import test from 'node:test';

import type { Card } from '@/generated/prisma/client';
import type { BillableExpense } from '@/lib/billing/charges';
import {
  type BillingCardState,
  planCardBilling,
} from '@/lib/billing/plan';
import { serializeCard } from '@/lib/billing/serialize';

const at = (day: string) => new Date(`${day}T12:00:00.000Z`);

function card(values: Partial<BillingCardState>): BillingCardState {
  return {
    id: 'card-1',
    closingDay: 5,
    pendingClosingDay: null,
    pendingClosingDaySetAt: null,
    minimumNextClosingOn: null,
    lastInvoicedOn: null,
    lastBillingProcessedAt: null,
    createdAt: at('2026-09-01'),
    ...values,
  };
}

function expense(values: Partial<BillableExpense>): BillableExpense {
  return {
    amount: '25',
    cardId: 'card-1',
    isInvoice: false,
    frequency: 'unica',
    startsAt: null,
    endsAt: null,
    occurredAt: at('2026-09-01'),
    createdAt: at('2026-09-01'),
    archivedAt: null,
    splits: [],
    ...values,
  };
}

test('billing includes a creation-day purchase in the first invoice only', () => {
  const now = at('2026-09-30');
  const plan = planCardBilling(card({}), [expense({})], at('2026-09-29'), now);
  assert.equal(plan.invoices.length, 1);
  assert.equal(plan.invoices[0].amount.toFixed(2), '25.00');
  assert.equal(plan.invoices[0].periodStart.toISOString(), '2026-09-01T12:00:00.000Z');
  assert.equal(plan.invoices[0].closingOn.toISOString(), '2026-09-05T12:00:00.000Z');
  assert.equal(plan.cardUpdate?.lastInvoicedOn.toISOString(), '2026-09-05T12:00:00.000Z');

  // Re-planning from the persisted state is a no-op (idempotent).
  const again = planCardBilling(
    card({
      lastInvoicedOn: plan.cardUpdate!.lastInvoicedOn,
      lastBillingProcessedAt: plan.cardUpdate!.lastBillingProcessedAt,
    }),
    [expense({})],
    at('2026-09-29'),
    now,
  );
  assert.equal(again.invoices.length, 0);
  assert.equal(again.cardUpdate, null);
});

test('a skipped closing (28-day rule) still bills every monthly occurrence', () => {
  const monthly = expense({
    frequency: 'mensal',
    amount: '40',
    occurredAt: null,
    startsAt: at('2026-08-01'),
    createdAt: at('2026-08-01'),
  });
  const plan = planCardBilling(
    card({
      closingDay: 31,
      pendingClosingDay: 5,
      pendingClosingDaySetAt: at('2026-08-10'),
      createdAt: at('2026-08-01'),
    }),
    [monthly],
    at('2026-10-05'),
    at('2026-10-06'),
  );

  assert.deepEqual(
    plan.invoices.map((invoice) => [
      invoice.closingOn.toISOString().slice(0, 10),
      invoice.amount.toFixed(2),
    ]),
    [
      ['2026-08-31', '40.00'],
      // closing 2026-09-05 is skipped (< 28 days); Oct 5 bills Sep 1 and Oct 1.
      ['2026-10-05', '80.00'],
    ],
  );
  assert.equal(plan.cardUpdate?.closingDay, 5);
  assert.equal(plan.cardUpdate?.pendingClosingDay, null);
});

test('weekly invoices bill 4 or 5 charges depending on the cycle', () => {
  const weekly = expense({
    frequency: 'semanal',
    occurredAt: null,
    startsAt: at('2026-08-31'),
  });
  const plan = planCardBilling(
    card({ lastInvoicedOn: at('2026-08-31'), lastBillingProcessedAt: at('2026-09-01') }),
    [weekly],
    at('2026-11-05'),
    at('2026-11-06'),
  );
  assert.deepEqual(
    plan.invoices.map((invoice) => invoice.amount.toFixed(2)),
    ['125.00', '100.00'],
  );
});

test('late one-off adjustments are added once to the next invoice', () => {
  const late = expense({
    occurredAt: at('2026-09-05'),
    createdAt: at('2026-09-07'),
  });
  const plan = planCardBilling(
    card({
      lastInvoicedOn: at('2026-09-05'),
      lastBillingProcessedAt: at('2026-09-06'),
    }),
    [late],
    at('2026-10-05'),
    at('2026-10-06'),
  );
  assert.equal(plan.invoices.length, 1);
  assert.equal(plan.invoices[0].amount.toFixed(2), '25.00');
  assert.match(plan.invoices[0].notes, /compras retroativas/);
});

test('card API serialization exposes the last billing processing timestamp', () => {
  const processedAt = at('2026-09-06');
  const serialized = serializeCard({
    id: 'card-1',
    name: 'Test card',
    limit: 100 as unknown as Card['limit'],
    closingDay: 5,
    pendingClosingDay: null,
    archivedAt: null,
    expiresAt: null,
    lastInvoicedOn: at('2026-09-05'),
    lastBillingProcessedAt: processedAt,
    createdAt: at('2026-01-01'),
    updatedAt: processedAt,
  } as Card);
  assert.equal(serialized.lastBillingProcessedAt, processedAt);
});

test('card API serialization exposes committed and available (null without a limit)', () => {
  const base = {
    id: 'card-1',
    name: 'Test card',
    limit: '100.00' as unknown as Card['limit'],
    closingDay: 5,
    pendingClosingDay: null,
    archivedAt: null,
    expiresAt: null,
    lastInvoicedOn: null,
    lastBillingProcessedAt: null,
    createdAt: at('2026-01-01'),
    updatedAt: at('2026-01-01'),
  } as Card;

  const used = serializeCard(base, 33.335);
  assert.equal(used.committed, 33.34);
  assert.equal(used.available, 66.66);
  assert.equal(used.limit, 100);

  const unlimited = serializeCard({ ...base, limit: null }, 20);
  assert.equal(unlimited.committed, 20);
  assert.equal(unlimited.available, null);

  assert.equal(serializeCard(base).committed, 0);
  assert.equal(serializeCard(base).available, 100);
  assert.equal(
    serializeCard({ ...base, archivedAt: at('2026-02-01') }, 50).committed,
    0,
  );
});
