import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';
import type { Card, Expense } from '@/generated/prisma/client';
import {
  chargeAmountForClosing,
  dateKeyInSaoPaulo,
  lateOneOffsTotalForClosing,
  listDueClosingDates,
  processUserCardBilling,
  serializeCard,
} from '@/lib/card-billing';

function expense(values: Partial<Expense>): Expense {
  return {
    id: 'expense-1',
    userId: 'user-1',
    cardId: 'card-1',
    name: 'Teste',
    amount: '25' as unknown as Expense['amount'],
    category: 'outro',
    frequency: 'unica',
    isInvoice: false,
    startsAt: null,
    endsAt: null,
    occurredAt: new Date('2026-09-01T12:00:00.000Z'),
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    ...values,
  } as Expense;
}

test('card API serialization exposes the last billing processing timestamp', () => {
  const processedAt = new Date('2026-09-06T12:00:00.000Z');
  const card = serializeCard({
    id: 'card-1',
    name: 'Test card',
    limit: 100 as unknown as Card['limit'],
    closingDay: 5,
    pendingClosingDay: null,
    archivedAt: null,
    expiresAt: null,
    lastInvoicedOn: new Date('2026-09-05T12:00:00.000Z'),
    lastBillingProcessedAt: processedAt,
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
    updatedAt: processedAt,
  } as Card);

  assert.equal(card.lastBillingProcessedAt, processedAt);
});

test('first cycle includes a one-off purchase on the card creation day', () => {
  const amount = chargeAmountForClosing(
    expense({}),
    'card-1',
    new Date('2026-09-05T12:00:00.000Z'),
    new Date('2026-09-01T12:00:00.000Z'),
    true,
  );

  assert.equal(amount, 25);
});

test('a one-off on the prior closing date is not billed in the next cycle', () => {
  const amount = chargeAmountForClosing(
    expense({ occurredAt: new Date('2026-09-05T12:00:00.000Z') }),
    'card-1',
    new Date('2026-10-05T12:00:00.000Z'),
    new Date('2026-09-05T12:00:00.000Z'),
  );

  assert.equal(amount, 0);
});

test('a one-off entered after the prior close is billed once as a late adjustment', () => {
  const latePurchase = expense({
    occurredAt: new Date('2026-09-05T12:00:00.000Z'),
    createdAt: new Date('2026-09-07T12:00:00.000Z'),
  });
  const priorProcessedAt = new Date('2026-09-06T12:00:00.000Z');
  const closedThrough = new Date('2026-09-05T12:00:00.000Z');

  assert.equal(
    lateOneOffsTotalForClosing(
      [latePurchase],
      'card-1',
      closedThrough,
      priorProcessedAt,
    ),
    25,
  );
  assert.equal(
    lateOneOffsTotalForClosing(
      [latePurchase],
      'card-1',
      closedThrough,
      new Date('2026-09-08T12:00:00.000Z'),
    ),
    0,
  );
});

test('weekly purchases reserve and bill four occurrences per cycle', () => {
  const amount = chargeAmountForClosing(
    expense({ frequency: 'semanal' }),
    'card-1',
    new Date('2026-09-05T12:00:00.000Z'),
    new Date('2026-09-01T12:00:00.000Z'),
  );

  assert.equal(amount, 100);
});

test('archiving preserves one-off card purchases but stops later recurring charges', () => {
  const archivedRecurring = expense({
    frequency: 'mensal',
    occurredAt: null,
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    startsAt: new Date('2026-09-01T12:00:00.000Z'),
    archivedAt: new Date('2026-09-20T12:00:00.000Z'),
  });
  const archivedOneOff = expense({
    occurredAt: new Date('2026-09-10T12:00:00.000Z'),
    archivedAt: new Date('2026-09-20T12:00:00.000Z'),
  });

  assert.equal(
    chargeAmountForClosing(
      archivedRecurring,
      'card-1',
      new Date('2026-10-05T12:00:00.000Z'),
      new Date('2026-09-05T12:00:00.000Z'),
    ),
    0,
  );
  assert.equal(
    chargeAmountForClosing(
      archivedOneOff,
      'card-1',
      new Date('2026-10-05T12:00:00.000Z'),
      new Date('2026-09-05T12:00:00.000Z'),
    ),
    25,
  );
});

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

test('timestamp boundaries use the São Paulo civil date', () => {
  assert.equal(
    dateKeyInSaoPaulo(new Date('2026-10-01T02:30:00.000Z')),
    '2026-09-30',
  );
});

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
    assert.equal(invoices[0].billingPeriodStart?.toISOString(), '2026-09-01T12:00:00.000Z');
    assert.equal(invoices[0].billingPeriodEnd?.toISOString(), '2026-09-05T12:00:00.000Z');
  } finally {
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
      await processUserCardBilling(user.id, new Date('2026-09-30T16:00:00.000Z')),
      { createdCount: 1 },
    );
    const afterFirstClose = await prisma.card.findUniqueOrThrow({
      where: { id: card.id },
    });
    assert.equal(afterFirstClose.closingDay, 5);
    assert.equal(afterFirstClose.pendingClosingDay, null);
    assert.equal(afterFirstClose.lastInvoicedOn?.toISOString(), '2026-08-31T12:00:00.000Z');

    assert.deepEqual(
      await processUserCardBilling(user.id, new Date('2026-10-06T16:00:00.000Z')),
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
      await processUserCardBilling(user.id, new Date('2026-10-06T16:00:00.000Z')),
      { createdCount: 1 },
    );
    assert.deepEqual(
      await processUserCardBilling(user.id, new Date('2026-11-06T16:00:00.000Z')),
      { createdCount: 0 },
    );

    const invoices = await prisma.expense.findMany({
      where: { userId: user.id, isInvoice: true },
      orderBy: { billingPeriodEnd: 'asc' },
    });
    assert.deepEqual(invoices.map((invoice) => Number(invoice.amount)), [25]);
    assert.match(invoices[0].notes ?? '', /compras retroativas/);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
