/* eslint-disable simple-import-sort/imports -- Configure disposable DB env before Prisma imports. */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { processUserCardBilling } from '@/lib/card-billing';
import { prisma } from '@/lib/prisma';
import { parseCreateExpense, parseUpdateExpense } from '@/services/expense-input';
import { createExpense, payExpense, updateExpense } from '@/services/expenses';

const at = (day: string) => new Date(`${day}T16:00:00.000Z`);

test('F02: persisted versioned obligations preserve old card and split on late invoice catch-up', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'F02 historical competence',
      email: `f02-version-${randomUUID()}@example.invalid`,
      passwordHash: 'not-a-login-hash',
    },
  });

  try {
    const [oldCard, newCard] = await Promise.all([
      prisma.card.create({ data: { userId: user.id, name: 'Original', closingDay: 31, createdAt: at('2026-08-01') } }),
      prisma.card.create({ data: { userId: user.id, name: 'Changed', closingDay: 31, createdAt: at('2026-08-01') } }),
    ]);
    const expense = await createExpense(user.id, parseCreateExpense({
      name: 'Historical obligation', category: 'outro', frequency: 'mensal',
      amount: 100, dueDay: 1, startsAt: '2026-08-01',
      splits: [
        { kind: 'card', cardId: oldCard.id, percent: 60 },
        { kind: 'pix', percent: 40 },
      ],
    }));

    // No August/September invoice exists. Current-month-only financial PATCH
    // must preserve them and can change the destination card for October.
    await updateExpense(user.id, expense.id, parseUpdateExpense({
      amount: 200,
      splits: [
        { kind: 'card', cardId: newCard.id, percent: 75 },
        { kind: 'pix', percent: 25 },
      ],
    }), at('2026-10-23'));
    await assert.rejects(
      () => updateExpense(user.id, expense.id, parseUpdateExpense({ dueDay: 15 }), at('2026-10-23')),
      /faturas pendentes/,
      'schedule edits must also protect unclosed obligations on the previous card',
    );

    const versions = await prisma.expenseObligationVersion.findMany({
      where: { expenseId: expense.id }, orderBy: { sequence: 'asc' },
    });
    await assert.rejects(
      () => prisma.expenseObligationVersion.update({
        where: { id: versions[0].id }, data: { amount: 999 },
      }),
      /immutable/,
      'SQL must reject rewriting a historical version even outside the application',
    );
    assert.deepEqual(versions.map((version) => [version.sequence, version.effectiveMonth, Number(version.amount)]), [
      [1, '2026-08', 100], [2, '2026-10', 200],
    ]);
    assert.deepEqual(versions.map((version) => version.splits), [
      [{ kind: 'card', cardId: oldCard.id, amount: '60', percent: '60' }, { kind: 'pix', cardId: null, amount: '40', percent: '40' }],
      [{ kind: 'card', cardId: newCard.id, amount: '150', percent: '75' }, { kind: 'pix', cardId: null, amount: '50', percent: '25' }],
    ]);

    assert.deepEqual(await processUserCardBilling(user.id, at('2026-11-01')), { createdCount: 3 });
    const invoices = await prisma.expense.findMany({
      where: { userId: user.id, isInvoice: true },
      orderBy: [{ billingPeriodEnd: 'asc' }, { amount: 'asc' }],
    });
    assert.deepEqual(invoices.map((invoice) => [
      invoice.cardId, invoice.billingPeriodEnd?.toISOString().slice(0, 10), Number(invoice.amount),
    ]), [
      [oldCard.id, '2026-08-31', 60],
      [oldCard.id, '2026-09-30', 60],
      [newCard.id, '2026-10-31', 150],
    ]);
    assert.deepEqual(await processUserCardBilling(user.id, at('2026-11-01')), { createdCount: 0 });

    await payExpense(user.id, expense.id, '2026-10');
    const paid = await prisma.expensePayment.findUniqueOrThrow({
      where: { expenseId_month: { expenseId: expense.id, month: '2026-10' } },
    });
    assert.equal(Number(paid.amount), 50);
    await assert.rejects(
      () => updateExpense(user.id, expense.id, parseUpdateExpense({ amount: 300 }), at('2026-10-23')),
      /paga nesta competência/,
    );
    assert.equal(await prisma.expenseObligationVersion.count({ where: { expenseId: expense.id } }), 2);
  } finally {
    const expenses = await prisma.expense.findMany({ where: { userId: user.id }, select: { id: true } });
    const expenseIds = expenses.map((expense) => expense.id);
    await prisma.expensePayment.deleteMany({ where: { expenseId: { in: expenseIds } } });
    await prisma.expenseSplit.deleteMany({ where: { expenseId: { in: expenseIds } } });
    await prisma.expense.deleteMany({ where: { userId: user.id } });
    await prisma.card.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('F02: old expenses without recorded versions must first settle overdue invoices', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'F02 legacy no invented history',
      email: `f02-legacy-${randomUUID()}@example.invalid`,
      passwordHash: 'not-a-login-hash',
    },
  });
  try {
    const card = await prisma.card.create({
      data: { userId: user.id, name: 'Legacy card', closingDay: 31, createdAt: at('2026-08-01') },
    });
    const legacy = await prisma.expense.create({
      data: {
        userId: user.id, cardId: card.id, name: 'Old expense', amount: 100,
        category: 'outro', frequency: 'mensal', startsAt: at('2026-08-01'), dueDay: 1,
      },
    });

    await assert.rejects(
      () => updateExpense(user.id, legacy.id, parseUpdateExpense({ amount: 200 }), at('2026-10-23')),
      /faturas pendentes/,
    );
    assert.equal(await prisma.expenseObligationVersion.count({ where: { expenseId: legacy.id } }), 0,
      'failed edit cannot fabricate retroactive history');
    assert.deepEqual(await processUserCardBilling(user.id, at('2026-10-23')), { createdCount: 2 });
    await updateExpense(user.id, legacy.id, parseUpdateExpense({ amount: 200 }), at('2026-10-23'));
    const versions = await prisma.expenseObligationVersion.findMany({
      where: { expenseId: legacy.id }, orderBy: { sequence: 'asc' },
    });
    assert.deepEqual(versions.map((row) => [row.effectiveMonth, Number(row.amount)]), [
      ['2026-08', 100], ['2026-10', 200],
    ]);
    assert.deepEqual(await processUserCardBilling(user.id, at('2026-11-01')), { createdCount: 1 });
    const invoices = await prisma.expense.findMany({
      where: { userId: user.id, isInvoice: true }, orderBy: { billingPeriodEnd: 'asc' },
    });
    assert.deepEqual(invoices.map((row) => Number(row.amount)), [100, 100, 200]);
  } finally {
    const expenses = await prisma.expense.findMany({ where: { userId: user.id }, select: { id: true } });
    const ids = expenses.map((expense) => expense.id);
    await prisma.expensePayment.deleteMany({ where: { expenseId: { in: ids } } });
    await prisma.expenseSplit.deleteMany({ where: { expenseId: { in: ids } } });
    await prisma.expense.deleteMany({ where: { userId: user.id } });
    await prisma.card.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
