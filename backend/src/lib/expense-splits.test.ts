/* eslint-disable simple-import-sort/imports -- Set the unit-test database URL before importing Prisma. */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma, type Card } from '@/generated/prisma/client';

import {
  getCommittedByCard,
  resolveAndValidateSplits,
} from '@/lib/expense-splits';

const at = (day: string) => new Date(`${day}T16:00:00.000Z`);

function historicalCommitmentDb(options: { invalidSnapshot?: boolean } = {}) {
  const card = (id: string, name: string): Card => ({
    id,
    userId: 'user-1',
    name,
    limit: new Prisma.Decimal(100),
    closingDay: 20,
    pendingClosingDay: null,
    pendingClosingDaySetAt: null,
    createdAt: at('2026-01-01'),
    updatedAt: at('2026-01-01'),
    archivedAt: null,
    lastInvoicedOn: at('2026-01-20'),
    lastBillingProcessedAt: at('2026-01-21'),
    minimumNextClosingOn: null,
    expiresAt: null,
  });
  const cards = [card('old-card', 'Cartão antigo'), card('new-card', 'Cartão novo')];
  const current = {
    id: 'recurring-1',
    amount: '10',
    cardId: 'new-card',
    isInvoice: false,
    frequency: 'mensal',
    startsAt: at('2026-01-01'),
    endsAt: null,
    occurredAt: null,
    dueDay: 25,
    createdAt: at('2026-01-01'),
    archivedAt: null,
    splits: [{ kind: 'card', cardId: 'new-card', amount: '10' }],
  };
  const versions = [
    {
      id: 'version-1', expenseId: current.id, sequence: 1,
      effectiveMonth: '2026-01', amount: '100', cardId: 'old-card',
      splits: [{ kind: 'card', cardId: 'old-card', amount: options.invalidSnapshot ? '90' : '100', percent: '100' }],
      createdAt: at('2026-01-01'),
    },
    {
      id: 'version-2', expenseId: current.id, sequence: 2,
      effectiveMonth: '2026-02', amount: '10', cardId: 'new-card',
      splits: [{ kind: 'card', cardId: 'new-card', amount: '10', percent: '100' }],
      createdAt: at('2026-02-05'),
    },
  ];
  const db = {
    card: {
      findMany: async (query: { where: { id?: { in: string[] } } }) =>
        cards.filter((item) => !query.where.id || query.where.id.in.includes(item.id)),
    },
    expense: {
      // Simulate Prisma: an omitted relation is not present in the returned row.
      findMany: async (query: { include: { obligationVersions?: unknown } }) => [{
        ...current,
        ...(query.include.obligationVersions ? { obligationVersions: versions } : {}),
      }],
    },
  } as unknown as Prisma.TransactionClient;
  return db;
}

test('card commitment reserves January R$100 in January 20–February 20 open cycle after February 5 edit to R$10 on another card', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-02-05') });
  const tx = historicalCommitmentDb();

  const committed = await getCommittedByCard({ userId: 'user-1', tx });
  assert.equal(committed.get('old-card'), 100);
  assert.equal(committed.get('new-card'), 0);

  await assert.rejects(
    () => resolveAndValidateSplits({
      userId: 'user-1', totalAmount: 1,
      splits: [{ kind: 'card', cardId: 'old-card', percent: 100 }],
      cardId: undefined, frequency: 'unica', tx,
    }),
    /Limite insuficiente.*Cartão antigo/,
    'an additional purchase on the old card must not oversubscribe its limit',
  );
  await resolveAndValidateSplits({
    userId: 'user-1', totalAmount: 50,
    splits: [{ kind: 'card', cardId: 'new-card', percent: 100 }],
    cardId: undefined, frequency: 'unica', tx,
  });
});

test('card commitment fails closed on a malformed persisted obligation snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: at('2026-02-05') });
  await assert.rejects(
    () => getCommittedByCard({ userId: 'user-1', tx: historicalCommitmentDb({ invalidSnapshot: true }) }),
    /Persisted expense obligation splits do not match amount/,
  );
});
