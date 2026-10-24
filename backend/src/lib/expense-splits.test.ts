/* eslint-disable simple-import-sort/imports -- Set the unit-test database URL before importing Prisma. */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma, type Card } from '@/generated/prisma/client';

import { chargeAmountForClosing, type BillableExpense } from '@/lib/billing/charges';
import {
  assertCardLimits,
  assertProspectiveVersionedCardLimits,
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

test('P2: a weekly edit must reserve January history plus three February charges without counting the candidate twice', () => {
  const asOf = at('2026-02-06');
  const card: Card = {
    id: 'card-500', userId: 'user-1', name: 'Limite R$500',
    limit: new Prisma.Decimal(500), closingDay: 20,
    pendingClosingDay: null, pendingClosingDaySetAt: null,
    createdAt: at('2026-01-01'), updatedAt: asOf,
    archivedAt: null, expiresAt: null,
    lastInvoicedOn: at('2026-01-20'), lastBillingProcessedAt: at('2026-01-21'),
    minimumNextClosingOn: null,
  };
  const prospective: BillableExpense = {
    amount: '50', cardId: card.id, isInvoice: false,
    frequency: 'semanal', startsAt: at('2026-01-21'),
    endsAt: null, occurredAt: null, createdAt: at('2026-01-21'),
    splits: [{ kind: 'card', cardId: card.id, amount: '50' }],
    obligationVersions: [
      { sequence: 1, effectiveMonth: '2026-01', amount: '100', cardId: card.id,
        splits: [{ kind: 'card', cardId: card.id, amount: '100' }] },
      { sequence: 2, effectiveMonth: '2026-02', amount: '10', cardId: card.id,
        splits: [{ kind: 'card', cardId: card.id, amount: '10' }] },
      { sequence: 3, effectiveMonth: '2026-02', amount: '50', cardId: card.id,
        splits: [{ kind: 'card', cardId: card.id, amount: '50' }] },
    ],
  };
  assert.equal(chargeAmountForClosing(prospective, card.id, at('2026-02-20'), at('2026-01-20')), 350);
  // Prior validation accepted 200 (one-off) + 5 x 50 = 450, ignoring
  // the edited expense's immutable 2 x 100 from January.
  assert.doesNotThrow(() => assertCardLimits({
    cards: new Map([[card.id, card]]),
    resolved: [{ kind: 'card', cardId: card.id, amount: 50, percent: 100 }],
    committedByCard: new Map([[card.id, 200]]), frequency: 'semanal',
  }));
  assert.throws(() => assertProspectiveVersionedCardLimits({
    cards: [card], otherCommittedByCard: new Map([[card.id, 200]]),
    prospective, asOf,
  }), /Limite insuficiente.*Limite R\$500/);

  const safe = {
    ...prospective,
    amount: '33.33',
    obligationVersions: [
      ...prospective.obligationVersions!.slice(0, -1),
      { sequence: 3, effectiveMonth: '2026-02', amount: '33.33', cardId: card.id,
        splits: [{ kind: 'card', cardId: card.id, amount: '33.33' }] },
    ],
  };
  assert.equal(chargeAmountForClosing(safe, card.id, at('2026-02-20'), at('2026-01-20')), 299.99);
  assert.doesNotThrow(() => assertProspectiveVersionedCardLimits({
    cards: [card], otherCommittedByCard: new Map([[card.id, 200]]),
    prospective: safe, asOf,
  }));
  const overByCent = {
    ...safe,
    amount: '33.34',
    obligationVersions: [
      ...safe.obligationVersions.slice(0, -1),
      { sequence: 3, effectiveMonth: '2026-02', amount: '33.34', cardId: card.id,
        splits: [{ kind: 'card', cardId: card.id, amount: '33.34' }] },
    ],
  };
  assert.equal(chargeAmountForClosing(overByCent, card.id, at('2026-02-20'), at('2026-01-20')), 300.02);
  assert.throws(() => assertProspectiveVersionedCardLimits({
    cards: [card], otherCommittedByCard: new Map([[card.id, 200]]),
    prospective: overByCent, asOf,
  }), /Limite insuficiente/);
});

test('P2: a moved split still validates historical obligations on the old card', () => {
  const asOf = at('2026-02-06');
  const card = (id: string): Card => ({
    id, userId: 'user-1', name: id, limit: new Prisma.Decimal(500),
    closingDay: 20, pendingClosingDay: null, pendingClosingDaySetAt: null,
    minimumNextClosingOn: null, archivedAt: null, expiresAt: null,
    lastInvoicedOn: at('2026-01-20'), lastBillingProcessedAt: at('2026-01-21'),
    createdAt: at('2026-01-01'), updatedAt: asOf,
  });
  const original = card('original');
  const destination = card('destination');
  const prospective: BillableExpense = {
    amount: '50', cardId: destination.id, isInvoice: false,
    frequency: 'semanal', startsAt: at('2026-01-21'), endsAt: null,
    occurredAt: null, createdAt: at('2026-01-21'),
    splits: [{ kind: 'card', cardId: destination.id, amount: '50' }],
    obligationVersions: [
      { sequence: 1, effectiveMonth: '2026-01', amount: '100', cardId: original.id,
        splits: [{ kind: 'card', cardId: original.id, amount: '100' }] },
      { sequence: 2, effectiveMonth: '2026-02', amount: '50', cardId: destination.id,
        splits: [{ kind: 'card', cardId: destination.id, amount: '50' }] },
    ],
  };
  assert.throws(() => assertProspectiveVersionedCardLimits({
    cards: [original, destination],
    otherCommittedByCard: new Map([[original.id, 350]]),
    prospective, asOf,
  }), /Limite insuficiente.*original/);
});

test('P2: schedule-only monthly-to-weekly edit exposes a hidden historical card reserve', () => {
  const asOf = at('2026-02-06');
  const card: Card = {
    id: 'card', userId: 'user', name: 'Card R$500', limit: new Prisma.Decimal(500),
    closingDay: 20, pendingClosingDay: null, pendingClosingDaySetAt: null,
    minimumNextClosingOn: null, archivedAt: null, expiresAt: null,
    lastInvoicedOn: at('2026-01-20'), lastBillingProcessedAt: at('2026-01-21'),
    createdAt: at('2026-01-01'), updatedAt: asOf,
  };
  const monthly: BillableExpense = {
    amount: '10', cardId: card.id, isInvoice: false,
    frequency: 'mensal', dueDay: 21, startsAt: at('2026-01-21'),
    endsAt: null, occurredAt: null, createdAt: at('2026-01-21'),
    splits: [{ kind: 'card', cardId: card.id, amount: '10' }],
    obligationVersions: [
      { sequence: 1, effectiveMonth: '2026-01', amount: '100', cardId: card.id,
        splits: [{ kind: 'card', cardId: card.id, amount: '100' }] },
      { sequence: 2, effectiveMonth: '2026-02', amount: '10', cardId: card.id,
        splits: [{ kind: 'card', cardId: card.id, amount: '10' }] },
    ],
  };
  const weekly = { ...monthly, frequency: 'semanal' };
  assert.equal(chargeAmountForClosing(monthly, card.id, at('2026-02-20'), at('2026-01-20')), 100);
  assert.equal(chargeAmountForClosing(weekly, card.id, at('2026-02-20'), at('2026-01-20')), 230);
  assert.doesNotThrow(() => assertCardLimits({
    cards: new Map([[card.id, card]]),
    resolved: [{ kind: 'card', cardId: card.id, amount: 10, percent: 100 }],
    committedByCard: new Map([[card.id, 300]]), frequency: 'semanal',
  }), 'the shallow check misses the history-dependent overflow');
  assert.throws(() => assertProspectiveVersionedCardLimits({
    cards: [card], otherCommittedByCard: new Map([[card.id, 300]]),
    prospective: weekly, asOf,
  }), /Limite insuficiente/);
});

test('prospective projection ignores unrelated already-overdrawn cards for PIX-only schedule changes', () => {
  const asOf = at('2026-02-06');
  const card: Card = {
    id: 'unrelated', userId: 'user', name: 'Already overdrawn',
    limit: new Prisma.Decimal(100), closingDay: 20,
    pendingClosingDay: null, pendingClosingDaySetAt: null,
    minimumNextClosingOn: null, archivedAt: null, expiresAt: null,
    lastInvoicedOn: at('2026-01-20'), lastBillingProcessedAt: at('2026-01-21'),
    createdAt: at('2026-01-01'), updatedAt: asOf,
  };
  const cashOnly: BillableExpense = {
    amount: '10', cardId: null, isInvoice: false, frequency: 'mensal',
    startsAt: at('2026-01-21'), endsAt: null, occurredAt: null,
    createdAt: at('2026-01-21'), splits: [],
  };
  // This expense reserves zero on the unrelated card even though other
  // committed debt already exceeds its user-adjusted R$100 limit.
  assert.doesNotThrow(() => assertProspectiveVersionedCardLimits({
    cards: [card], otherCommittedByCard: new Map([[card.id, 101]]),
    prospective: cashOnly, asOf,
  }));
  assert.throws(() => assertProspectiveVersionedCardLimits({
    cards: [card], otherCommittedByCard: new Map([[card.id, 101]]),
    prospective: { ...cashOnly, cardId: card.id, splits: [{ kind: 'card', cardId: card.id, amount: '10' }] }, asOf,
  }), /Limite insuficiente/);
});
