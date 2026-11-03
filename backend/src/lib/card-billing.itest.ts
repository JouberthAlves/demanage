import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { processUserCardBilling } from '@/lib/card-billing';
import { todayKeyInSaoPaulo } from '@/lib/civil-date';
import { prisma } from '@/lib/prisma';
import { archiveCard } from '@/services/cards';
import { parseUpdateExpense } from '@/services/expense-input';
import { archiveExpense, updateExpense } from '@/services/expenses';

// Needs a real PostgreSQL (DATABASE_URL). Pure billing logic is covered by
// lib/billing/*.test.ts. Run with: tsx --test src/**/*.itest.ts

test('billing includes a creation-day purchase once and is idempotent', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Card billing test',
      email: `card-billing-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    const card = await prisma.card.create({
      data: {
        userId: user.id,
        name: 'Test card',
        closingDay: 5,
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    });
    await prisma.expense.create({
      data: {
        userId: user.id,
        cardId: card.id,
        name: 'Purchase on creation day',
        amount: 25,
        category: 'outro',
        frequency: 'unica',
        occurredAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    });

    const now = new Date('2026-09-30T16:00:00.000Z');
    assert.deepEqual(await processUserCardBilling(user.id, now), {
      createdCount: 1,
    });
    assert.deepEqual(await processUserCardBilling(user.id, now), {
      createdCount: 0,
    });

    const invoices = await prisma.expense.findMany({
      where: { userId: user.id, isInvoice: true },
    });
    assert.equal(invoices.length, 1);
    assert.equal(Number(invoices[0].amount), 25);
    assert.equal(
      invoices[0].billingPeriodStart?.toISOString(),
      '2026-09-01T12:00:00.000Z',
    );
    assert.equal(
      invoices[0].billingPeriodEnd?.toISOString(),
      '2026-09-05T12:00:00.000Z',
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('A04: real PostgreSQL invoices a pre-creation purchase once across first and subsequent card cycles', async () => {
  const user = await prisma.user.create({
    data: { name: 'A04 backdated purchase', email: `a04-${randomUUID()}@example.invalid`, passwordHash: 'test-only' },
  });
  try {
    const card = await prisma.card.create({
      data: { userId: user.id, name: 'A04 card', closingDay: 20, createdAt: new Date('2026-03-15T12:00:00.000Z') },
    });
    await prisma.expense.create({
      data: { userId: user.id, cardId: card.id, name: 'Before card', category: 'outro',
        frequency: 'unica', amount: '37.25', occurredAt: new Date('2026-03-05T12:00:00.000Z'),
        createdAt: new Date('2026-03-16T12:00:00.000Z') },
    });
    assert.deepEqual(await processUserCardBilling(user.id, new Date('2026-04-21T16:00:00.000Z')), { createdCount: 1 });
    assert.deepEqual(await processUserCardBilling(user.id, new Date('2026-05-21T16:00:00.000Z')), { createdCount: 0 });
    const invoices = await prisma.expense.findMany({ where: { userId: user.id, isInvoice: true } });
    assert.deepEqual(invoices.map((invoice) => [invoice.billingPeriodEnd?.toISOString().slice(0, 10), invoice.amount.toFixed(2)]), [
      ['2026-03-20', '37.25'],
    ]);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('A04: archiving an unbilled card preserves its pre-creation one-off purchase in the final invoice', async () => {
  const user = await prisma.user.create({
    data: { name: 'A04 final archive', email: `a04-final-${randomUUID()}@example.invalid`, passwordHash: 'test-only' },
  });
  try {
    const card = await prisma.card.create({ data: {
      userId: user.id, name: 'A04 final card', closingDay: 20,
      createdAt: new Date('2026-03-15T12:00:00.000Z'),
    } });
    await prisma.expense.create({ data: {
      userId: user.id, cardId: card.id, name: 'Before card', amount: '17.15', category: 'outro', frequency: 'unica',
      occurredAt: new Date('2026-03-05T12:00:00.000Z'), createdAt: new Date('2026-03-16T12:00:00.000Z'),
    } });
    await archiveCard(user.id, card.id);
    const invoices = await prisma.expense.findMany({ where: { userId: user.id, isInvoice: true } });
    assert.deepEqual(invoices.map((invoice) => invoice.amount.toFixed(2)), ['17.15']);
    await assert.rejects(() => archiveCard(user.id, card.id), /Cartão não encontrado/);
    assert.equal(await prisma.expense.count({ where: { userId: user.id, isInvoice: true } }), 1);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('A05: archive refuses live recurring card and split obligations without creating a final invoice', async () => {
  const user = await prisma.user.create({
    data: { name: 'A05 active subscriptions', email: `a05-${randomUUID()}@example.invalid`, passwordHash: 'test-only' },
  });
  try {
    const card = await prisma.card.create({ data: { userId: user.id, name: 'A05 card', closingDay: 20 } });
    await prisma.expense.create({ data: {
      userId: user.id, cardId: card.id, name: 'Monthly card', category: 'outro',
      frequency: 'mensal', amount: 10, dueDay: 1, startsAt: new Date('2026-10-01T00:00:00.000Z'),
    } });
    const split = await prisma.expense.create({ data: {
      userId: user.id, name: 'Split weekly', category: 'outro',
      frequency: 'semanal', amount: 20, dueDay: 1, startsAt: new Date('2026-10-01T00:00:00.000Z'),
      splits: { create: [
        { kind: 'card', cardId: card.id, amount: 10, percent: 50 },
        { kind: 'pix', cardId: null, amount: 10, percent: 50 },
      ] },
    } });
    await assert.rejects(() => archiveCard(user.id, card.id), /recorrência|recorrentes|recorrente/);
    await prisma.expense.updateMany({ where: { userId: user.id, cardId: card.id, isInvoice: false }, data: { archivedAt: new Date() } });
    await assert.rejects(() => archiveCard(user.id, card.id), /recorrência|recorrentes|recorrente/,
      'a split-only obligation must also block archive');
    const after = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    assert.equal(after.archivedAt, null);
    assert.equal(await prisma.expense.count({ where: { userId: user.id, isInvoice: true } }), 0);
    await prisma.expense.update({ where: { id: split.id }, data: { archivedAt: new Date() } });
    await archiveCard(user.id, card.id);
    assert.notEqual((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).archivedAt, null);
  } finally {
    await prisma.expenseSplit.deleteMany({ where: { expense: { userId: user.id } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('pending closing-day change skips a cycle shorter than 28 days', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Pending card billing test',
      email: `card-pending-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    const card = await prisma.card.create({
      data: {
        userId: user.id,
        name: 'Test card',
        closingDay: 31,
        pendingClosingDay: 5,
        pendingClosingDaySetAt: new Date('2026-08-10T12:00:00.000Z'),
        createdAt: new Date('2026-08-01T12:00:00.000Z'),
      },
    });
    await prisma.expense.create({
      data: {
        userId: user.id,
        cardId: card.id,
        name: 'Monthly subscription',
        amount: 40,
        category: 'outro',
        frequency: 'mensal',
        startsAt: new Date('2026-08-01T12:00:00.000Z'),
      },
    });

    assert.deepEqual(
      await processUserCardBilling(
        user.id,
        new Date('2026-09-30T16:00:00.000Z'),
      ),
      { createdCount: 1 },
    );
    const afterFirstClose = await prisma.card.findUniqueOrThrow({
      where: { id: card.id },
    });
    assert.equal(afterFirstClose.closingDay, 5);
    assert.equal(afterFirstClose.pendingClosingDay, null);
    assert.equal(
      afterFirstClose.lastInvoicedOn?.toISOString(),
      '2026-08-31T12:00:00.000Z',
    );

    assert.deepEqual(
      await processUserCardBilling(
        user.id,
        new Date('2026-10-06T16:00:00.000Z'),
      ),
      { createdCount: 1 },
    );
    const invoices = await prisma.expense.findMany({
      where: { userId: user.id, isInvoice: true },
      orderBy: { billingPeriodEnd: 'asc' },
    });
    assert.deepEqual(
      invoices.map((invoice) => invoice.billingPeriodEnd?.toISOString()),
      ['2026-08-31T12:00:00.000Z', '2026-10-05T12:00:00.000Z'],
    );
    // The skipped 2026-09-05 closing must not drop a monthly charge:
    // Sep 1 and Oct 1 are both billed on the October invoice.
    assert.deepEqual(
      invoices.map((invoice) => Number(invoice.amount)),
      [40, 80],
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('F10: persisted dueDay 31 survives February clamping and a pending closing-day change', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'F10 due-day billing test',
      email: `card-due31-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    const card = await prisma.card.create({
      data: {
        userId: user.id,
        name: 'F10 card',
        closingDay: 31,
        pendingClosingDay: 29,
        pendingClosingDaySetAt: new Date('2026-01-10T12:00:00.000Z'),
        createdAt: new Date('2026-01-01T12:00:00.000Z'),
      },
    });
    await prisma.expense.create({
      data: {
        userId: user.id,
        cardId: card.id,
        name: 'Day 31 subscription',
        amount: 75,
        category: 'outro',
        frequency: 'mensal',
        dueDay: 31,
        startsAt: new Date('2026-02-28T00:00:00.000Z'),
      },
    });

    const now = new Date('2026-04-30T16:00:00.000Z');
    assert.deepEqual(await processUserCardBilling(user.id, now), {
      createdCount: 2,
    });
    assert.deepEqual(await processUserCardBilling(user.id, now), {
      createdCount: 0,
    });

    const invoices = await prisma.expense.findMany({
      where: { userId: user.id, isInvoice: true },
      orderBy: { billingPeriodEnd: 'asc' },
    });
    assert.deepEqual(
      invoices.map((invoice) => [
        invoice.billingPeriodEnd?.toISOString().slice(0, 10),
        Number(invoice.amount),
      ]),
      [
        ['2026-02-28', 75],
        ['2026-04-29', 75],
      ],
    );
    const savedCard = await prisma.card.findUniqueOrThrow({
      where: { id: card.id },
    });
    assert.equal(savedCard.closingDay, 29);
    assert.equal(savedCard.pendingClosingDay, null);
    assert.equal(
      savedCard.lastInvoicedOn?.toISOString().slice(0, 10),
      '2026-04-29',
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('billing includes a purchase entered after a cycle closed without billing it twice', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Late card billing test',
      email: `card-late-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    const card = await prisma.card.create({
      data: {
        userId: user.id,
        name: 'Test card',
        closingDay: 5,
        lastInvoicedOn: new Date('2026-09-05T12:00:00.000Z'),
        lastBillingProcessedAt: new Date('2026-09-06T12:00:00.000Z'),
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    });
    await prisma.expense.create({
      data: {
        userId: user.id,
        cardId: card.id,
        name: 'Late purchase on prior closing day',
        amount: 25,
        category: 'outro',
        frequency: 'unica',
        occurredAt: new Date('2026-09-05T12:00:00.000Z'),
        createdAt: new Date('2026-09-07T12:00:00.000Z'),
      },
    });

    assert.deepEqual(
      await processUserCardBilling(
        user.id,
        new Date('2026-10-06T16:00:00.000Z'),
      ),
      { createdCount: 1 },
    );
    assert.deepEqual(
      await processUserCardBilling(
        user.id,
        new Date('2026-11-06T16:00:00.000Z'),
      ),
      { createdCount: 0 },
    );

    const invoices = await prisma.expense.findMany({
      where: { userId: user.id, isInvoice: true },
      orderBy: { billingPeriodEnd: 'asc' },
    });
    assert.deepEqual(
      invoices.map((invoice) => Number(invoice.amount)),
      [25],
    );
    assert.match(invoices[0].notes ?? '', /compras retroativas/);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('F02: delayed closes preserve old monthly amount/split before October-equivalent change', async () => {
  // Relative months ensure the regression is valid even when run after 2026.
  const [year, month] = todayKeyInSaoPaulo().split('-').map(Number);
  const firstOfOldMonth = new Date(Date.UTC(year, month - 3, 1, 12));
  const firstOfNextMonth = new Date(Date.UTC(year, month, 1, 16));
  const user = await prisma.user.create({
    data: {
      name: 'F02 historical close test',
      email: `card-obligation-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    const card = await prisma.card.create({
      data: {
        userId: user.id,
        name: 'F02 card',
        closingDay: 31,
        createdAt: firstOfOldMonth,
      },
    });
    const expense = await prisma.expense.create({
      data: {
        userId: user.id,
        name: 'Recurring obligation',
        amount: 100,
        category: 'outro',
        frequency: 'mensal',
        dueDay: 1,
        startsAt: firstOfOldMonth,
        createdAt: firstOfOldMonth,
        splits: {
          create: [
            { kind: 'card', cardId: card.id, percent: 60, amount: 60 },
            { kind: 'pix', percent: 40, amount: 40 },
          ],
        },
      },
    });
    const change = parseUpdateExpense({
      amount: 200,
      splits: [
        { kind: 'card', cardId: card.id, percent: 75 },
        { kind: 'pix', percent: 25 },
      ],
    });

    await assert.rejects(
      () => updateExpense(user.id, expense.id, change),
      /Feche as faturas pendentes/,
    );
    await assert.rejects(
      () => archiveExpense(user.id, expense.id),
      /Feche as faturas pendentes/,
    );
    const unchanged = await prisma.expense.findUniqueOrThrow({
      where: { id: expense.id },
      include: { splits: true },
    });
    assert.equal(Number(unchanged.amount), 100);
    assert.deepEqual(
      unchanged.splits.map((split) => Number(split.amount)).sort(),
      [40, 60],
    );

    assert.deepEqual(await processUserCardBilling(user.id), {
      createdCount: 2,
    });
    await updateExpense(user.id, expense.id, change);
    assert.deepEqual(await processUserCardBilling(user.id, firstOfNextMonth), {
      createdCount: 1,
    });
    const invoices = await prisma.expense.findMany({
      where: { userId: user.id, isInvoice: true },
      orderBy: { billingPeriodEnd: 'asc' },
    });
    assert.deepEqual(
      invoices.map((invoice) => Number(invoice.amount)),
      [60, 60, 150],
    );
    assert.deepEqual(await processUserCardBilling(user.id, firstOfNextMonth), {
      createdCount: 0,
    });
  } finally {
    // ExpenseSplit.cardId is RESTRICT, so the user's cards cannot cascade
    // away while split rows still reference them. Remove fixture splits first.
    await prisma.expenseSplit.deleteMany({
      where: { expense: { userId: user.id } },
    });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
