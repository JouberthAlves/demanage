import assert from 'node:assert/strict';
import test from 'node:test';

import { availableCardLimit, buildCommittedByCard } from '@/lib/expense-splits';
import type { Card, RecurringExpense } from '@/types/finance';

test('limit commitment includes retroactive one-offs added after a card close', () => {
  const card: Card = {
    id: 'card-1',
    name: 'Cartão',
    limit: 100,
    closingDay: 5,
    lastInvoicedOn: '2026-09-05T12:00:00.000Z',
    lastBillingProcessedAt: '2026-09-06T12:00:00.000Z',
    createdAt: '2026-01-01T12:00:00.000Z',
  };
  const expense: RecurringExpense = {
    id: 'expense-1',
    name: 'Compra informada depois do fechamento',
    amount: 80,
    category: 'outro',
    frequency: 'unica',
    cardId: 'card-1',
    registeredAt: '2026-09-05',
    createdAt: '2026-09-07T12:00:00.000Z',
  };

  const committed = buildCommittedByCard(
    [expense],
    [card],
    new Date('2026-09-10T12:00:00.000Z'),
  );

  assert.equal(card.lastBillingProcessedAt, '2026-09-06T12:00:00.000Z');
  assert.equal(committed.get(card.id), 80);
  assert.equal(
    availableCardLimit({ limit: card.limit, committed: committed.get(card.id) ?? 0 }),
    20,
  );
});

test('late one-offs already present at the previous close are not reserved twice', () => {
  const card: Card = {
    id: 'card-1',
    name: 'Cartão',
    lastInvoicedOn: '2026-09-05T12:00:00.000Z',
    lastBillingProcessedAt: '2026-09-06T12:00:00.000Z',
  };
  const expense: RecurringExpense = {
    id: 'expense-1',
    name: 'Compra já processada',
    amount: 80,
    category: 'outro',
    frequency: 'unica',
    cardId: 'card-1',
    registeredAt: '2026-09-05',
    createdAt: '2026-09-06T11:59:59.000Z',
  };

  const committed = buildCommittedByCard(
    [expense],
    [card],
    new Date('2026-09-10T12:00:00.000Z'),
  );

  assert.equal(committed.get(card.id), undefined);
});
