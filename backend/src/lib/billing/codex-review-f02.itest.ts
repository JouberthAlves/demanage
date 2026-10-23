/* eslint-disable simple-import-sort/imports -- Configure disposable DB env before Prisma imports. */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { processUserCardBilling } from '@/lib/card-billing';
import { prisma } from '@/lib/prisma';
import { parseCreateExpense, parseUpdateExpense } from '@/services/expense-input';
import { createExpense, updateExpense } from '@/services/expenses';

const at = (day: string) => new Date(`${day}T16:00:00.000Z`);

async function fixture(label: string) {
  return prisma.user.create({
    data: { name: label, email: `review-f02-${randomUUID()}@example.invalid`, passwordHash: 'tests-only' },
  });
}

async function cleanup(userId: string) {
  const expenses = await prisma.expense.findMany({ where: { userId }, select: { id: true } });
  const ids = expenses.map(({ id }) => id);
  await prisma.expensePayment.deleteMany({ where: { expenseId: { in: ids } } });
  await prisma.expenseSplit.deleteMany({ where: { expenseId: { in: ids } } });
  await prisma.expense.deleteMany({ where: { userId } });
  await prisma.card.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

test('Codex P1: legacy January 25 obligation survives February 5 edit within January20-February20 cycle', async () => {
  const user = await fixture('P1 legacy open card cycle');
  try {
    const card = await prisma.card.create({ data: {
      userId: user.id, name: 'January close', closingDay: 20,
      createdAt: at('2026-01-01'), lastInvoicedOn: at('2026-01-20'),
      lastBillingProcessedAt: at('2026-01-21'),
    } });
    const legacy = await prisma.expense.create({ data: {
      userId: user.id, name: 'Recurring due day 25', category: 'outro',
      frequency: 'mensal', amount: 100, cardId: card.id, dueDay: 25,
      startsAt: at('2026-01-01'), createdAt: at('2026-01-01'),
    } });
    await updateExpense(user.id, legacy.id, parseUpdateExpense({ amount: 200 }), at('2026-02-05'));
    const versions = await prisma.expenseObligationVersion.findMany({ where: { expenseId: legacy.id }, orderBy: { sequence: 'asc' } });
    assert.deepEqual(versions.map(v => [v.effectiveMonth, Number(v.amount)]), [
      ['2026-01', 100], ['2026-02', 200],
    ]);
    assert.deepEqual(await processUserCardBilling(user.id, at('2026-02-21')), { createdCount: 1 });
    assert.deepEqual(await processUserCardBilling(user.id, at('2026-03-21')), { createdCount: 1 });
    const invoices = await prisma.expense.findMany({ where: { userId: user.id, isInvoice: true }, orderBy: { billingPeriodEnd: 'asc' } });
    assert.deepEqual(invoices.map(i => [i.billingPeriodEnd?.toISOString().slice(0, 10), Number(i.amount)]), [
      ['2026-02-20', 100], ['2026-03-20', 200],
    ]);
  } finally { await cleanup(user.id); }
});

test('Codex P2: moving a recurring start from December to October fails atomically before first invoice', async () => {
  const user = await fixture('P2 prevent versionless earlier months');
  try {
    const card = await prisma.card.create({ data: { userId: user.id, name: 'Next invoice', closingDay: 20, createdAt: at('2026-09-01') } });
    const expense = await createExpense(user.id, parseCreateExpense({
      name: 'December scheduled', category: 'outro', frequency: 'mensal', amount: 100,
      startsAt: '2026-12-01', dueDay: 1, cardId: card.id,
    }));
    await assert.rejects(
      () => updateExpense(user.id, expense.id, parseUpdateExpense({ startsAt: '2026-10-01' }), at('2026-09-15')),
      /antecipar|retroativ|competência/i,
    );
    const unchanged = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    assert.equal(unchanged.startsAt?.toISOString().slice(0, 10), '2026-12-01');
    assert.deepEqual((await prisma.expenseObligationVersion.findMany({ where: { expenseId: expense.id } })).map(v => v.effectiveMonth), ['2026-12']);
  } finally { await cleanup(user.id); }
});
