import assert from 'node:assert/strict';
import test from 'node:test';

import { selectCardCommitments } from '@/lib/card-commitment';
import type { Card, RecurringExpense } from '@/types/finance';

const NOW = new Date('2026-09-20T15:00:00.000Z');

function card(changes: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    name: 'Cartão',
    limit: 1000,
    closingDay: 5,
    createdAt: '2026-01-01T12:00:00.000Z',
    ...changes,
  };
}

function expense(changes: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 'e1',
    name: 'Compra',
    amount: 100,
    category: 'outro',
    frequency: 'mensal',
    cardId: 'card-1',
    ...changes,
  } as RecurringExpense;
}

test('weekly expenses count four times against the limit', () => {
  const [item] = selectCardCommitments(
    [expense({ frequency: 'semanal', amount: 50 })],
    [card()],
    NOW,
  );
  assert.equal(item?.committed, 200);
  assert.equal(item?.percent, 20);
});

test('one-offs before the last closed invoice are not committed', () => {
  const closed = card({
    lastInvoicedOn: '2026-09-05T12:00:00.000Z',
    lastBillingProcessedAt: '2026-09-06T12:00:00.000Z',
  });
  const [item] = selectCardCommitments(
    [
      expense({
        id: 'old',
        frequency: 'unica',
        registeredAt: '2026-08-20',
        createdAt: '2026-08-20T12:00:00.000Z',
        amount: 300,
      }),
      expense({
        id: 'new',
        frequency: 'unica',
        registeredAt: '2026-09-10',
        createdAt: '2026-09-10T12:00:00.000Z',
        amount: 120,
      }),
    ],
    [closed],
    NOW,
  );
  assert.equal(item?.committed, 120);
});

test('invoice expenses and other cards are ignored', () => {
  const [item] = selectCardCommitments(
    [
      expense({ isInvoice: true, amount: 900 }),
      expense({ id: 'other', cardId: 'card-2', amount: 400 }),
      expense({ id: 'mine', amount: 75 }),
    ],
    [card()],
    NOW,
  );
  assert.equal(item?.committed, 75);
});

test('cards without a limit are skipped and the limit is never cast', () => {
  const result = selectCardCommitments(
    [expense()],
    [card({ limit: undefined }), card({ id: 'zero', limit: 0 })],
    NOW,
  );
  assert.deepEqual(result, []);
});
