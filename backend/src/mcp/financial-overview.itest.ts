import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { todayKeyInSaoPaulo } from '@/lib/civil-date';
import { readPatrimonySnapshot } from '@/lib/patrimony-snapshot';
import { prisma } from '@/lib/prisma';
import { parseCreateExpense } from '@/services/expense-input';
import { archiveExpense, createExpense } from '@/services/expenses';
import { listPiggyCashMovements } from '@/services/piggy-banks';

import {
  calculateMonthlyCash, getFinancialOverview, MCP_PATRIMONY_SNAPSHOT_ROW_BUDGET,
  patrimonyWithinHistoryBudget,
} from './financial-overview';

test('MCP excludes voided PIX payments but preserves archived cash and independent receipts', async () => {
  const user = await prisma.user.create({ data: {
    name: 'MCP voided cash regression',
    email: `mcp-voided-${randomUUID()}@example.invalid`, passwordHash: 'test-only',
  } });
  const today = todayKeyInSaoPaulo();
  const now = new Date(`${today}T21:00:00.000Z`);
  try {
    await prisma.patrimonySettings.create({ data: {
      userId: user.id, baseDate: new Date('2026-01-01T12:00:00.000Z'), openingCashBrl: 0,
    } });
    const voided = await createExpense(user.id, parseCreateExpense({
      name: 'Pagamento PIX anulado', amount: 85, category: 'outro',
      frequency: 'unica', date: today,
    }));
    const paid = await prisma.expensePayment.findFirstOrThrow({ where: { expenseId: voided.id } });
    assert.equal(Number(paid.amount), 85);

    const archived = await prisma.expense.create({ data: {
      userId: user.id, name: 'Pagamento PIX apenas arquivado',
      category: 'outro', frequency: 'unica', amount: 35,
      occurredAt: new Date(`${today}T12:00:00.000Z`), archivedAt: now,
      payments: { create: [{ month: today.slice(0, 7), amount: 35,
        paidAt: new Date(`${today}T14:00:00.000Z`) }] },
    } });
    const entry = await prisma.entry.create({ data: {
      userId: user.id, name: 'Recebimento independente',
      type: 'outro', frequency: 'unica', amount: 45,
      date: new Date(`${today}T12:00:00.000Z`),
      receipts: { create: [{ month: today.slice(0, 7), amount: 45,
        receivedAt: new Date(`${today}T14:00:00.000Z`) }] },
    } });

    const before = (await getFinancialOverview(user.id, now)).monthly;
    assert.equal(before.expensesBrl, '120.00');
    assert.equal(before.incomeBrl, '45.00');

    await archiveExpense(user.id, voided.id);
    const stored = await prisma.expense.findUniqueOrThrow({
      where: { id: voided.id }, include: { payments: true },
    });
    assert.ok(stored.voidedAt);
    assert.ok(stored.archivedAt);
    assert.equal(stored.payments[0]?.id, paid.id, 'void keeps an auditable payment');
    const snapshot = await readPatrimonySnapshot(prisma, user.id);
    assert.equal(snapshot.expenses.some((expense) => expense.id === voided.id), false);
    assert.equal(snapshot.expenses.some((expense) => expense.id === archived.id), true);

    const after = (await getFinancialOverview(user.id, now)).monthly;
    assert.deepEqual(after, {
      month: today.slice(0, 7), incomeBrl: '45.00',
      expensesBrl: '35.00', balanceBrl: '10.00',
    });
    assert.equal(await prisma.entryReceipt.count({ where: { entryId: entry.id } }), 1);
  } finally {
    await prisma.expensePayment.deleteMany({ where: { expense: { userId: user.id } } });
    await prisma.entryReceipt.deleteMany({ where: { entry: { userId: user.id } } });
    await prisma.expense.deleteMany({ where: { userId: user.id } });
    await prisma.entry.deleteMany({ where: { userId: user.id } });
    await prisma.patrimonySettings.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('MCP keeps recorded cash after archiving parents, without including system movements', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'MCP archive cash history',
      email: `mcp-history-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only',
    },
  });
  try {
    const expense = await prisma.expense.create({
      data: {
        userId: user.id,
        name: 'Pagamento manual',
        category: 'outro',
        frequency: 'unica',
        amount: 999,
        occurredAt: new Date('2026-10-02T12:00:00.000Z'),
        payments: { create: [{
          month: '2026-10', amount: 35,
          paidAt: new Date('2026-10-11T14:00:00.000Z'),
        }] },
      },
    });
    const entry = await prisma.entry.create({
      data: {
        userId: user.id,
        name: 'Recebimento manual',
        type: 'outro',
        frequency: 'unica',
        amount: 999,
        date: new Date('2026-10-02T12:00:00.000Z'),
        receipts: { create: [{
          month: '2026-10', amount: 45,
          receivedAt: new Date('2026-10-10T14:00:00.000Z'),
        }] },
      },
    });
    await prisma.expense.create({
      data: {
        userId: user.id,
        name: 'Não incluir sistema',
        category: 'outro',
        frequency: 'unica',
        systemOrigin: 'asset',
        amount: 800,
        occurredAt: new Date('2026-10-10T12:00:00.000Z'),
      },
    });

    const now = new Date('2026-10-18T18:00:00.000Z');
    const before = (await getFinancialOverview(user.id, now)).monthly;
    assert.deepEqual(before, {
      month: '2026-10', incomeBrl: '45.00',
      expensesBrl: '35.00', balanceBrl: '10.00',
    });

    await prisma.expense.update({ where: { id: expense.id }, data: { archivedAt: now } });
    await prisma.entry.update({ where: { id: entry.id }, data: { archivedAt: now } });
    const after = (await getFinancialOverview(user.id, now)).monthly;
    assert.deepEqual(after, before);
  } finally {
    await prisma.expensePayment.deleteMany({ where: { expense: { userId: user.id } } });
    await prisma.entryReceipt.deleteMany({ where: { entry: { userId: user.id } } });
    await prisma.expense.deleteMany({ where: { userId: user.id } });
    await prisma.entry.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('MCP preserves exact monthly cash but skips oversized optional patrimony snapshots', async () => {
  const user = await prisma.user.create({ data: {
    name: 'MCP patrimony budget', email: `mcp-patrimony-budget-${randomUUID()}@example.invalid`,
    passwordHash: 'test-only',
  } });
  try {
    await prisma.patrimonySettings.create({ data: {
      userId: user.id, baseDate: new Date('2026-01-01T12:00:00.000Z'), openingCashBrl: 0,
    } });
    const bank = await prisma.piggyBank.create({ data: {
      userId: user.id, name: 'Historical bank', monthlyGoal: 0,
    } });
    await prisma.piggyTransaction.createMany({ data: Array.from({ length: MCP_PATRIMONY_SNAPSHOT_ROW_BUDGET + 1 }, (_, i) => ({
      userId: user.id, piggyBankId: bank.id, type: i % 2 ? 'deposit' as const : 'withdraw' as const,
      amount: 0.01, date: new Date('2026-02-01T12:00:00.000Z'),
    })) });
    assert.equal(await patrimonyWithinHistoryBudget(user.id), false);
    const overview = await getFinancialOverview(user.id, new Date('2026-10-18T12:00:00.000Z'));
    assert.deepEqual(overview.monthly, {
      month: '2026-10', incomeBrl: '0.00', expensesBrl: '0.00', balanceBrl: '0.00',
    });
    assert.deepEqual(overview.patrimony, { status: 'unavailable', reason: 'history_budget_exceeded' },
      'oversized legacy snapshot must not exhaust MCP memory or fabricate a patrimony summary');
  } finally {
    await prisma.piggyTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.piggyBank.deleteMany({ where: { userId: user.id } });
    await prisma.patrimonySettings.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('MCP paged history equals the full ledger after 128+ parents and child records', async () => {
  const user = await prisma.user.create({
    data: { name: 'MCP paged stress', email: `mcp-paged-${randomUUID()}@example.invalid`, passwordHash: 'test-only' },
  });
  const now = new Date('2026-10-18T18:00:00.000Z');
  try {
    const entries = Array.from({ length: 263 }, (_, i) => ({
      id: randomUUID(), userId: user.id, name: `Income ${i}`, type: 'outro' as const,
      frequency: 'unica' as const, amount: 900,
      date: new Date('2026-10-01T12:00:00.000Z'),
      archivedAt: i % 5 === 0 ? now : null,
    }));
    const expenses = Array.from({ length: 267 }, (_, i) => ({
      id: randomUUID(), userId: user.id, name: `Expense ${i}`, category: 'outro' as const,
      frequency: 'unica' as const, amount: 800,
      occurredAt: new Date('2026-10-01T12:00:00.000Z'),
      archivedAt: i % 7 === 0 ? now : null,
    }));
    await prisma.entry.createMany({ data: entries });
    await prisma.expense.createMany({ data: expenses });
    await prisma.entryReceipt.createMany({ data: entries.map((entry, i) => ({
      entryId: entry.id, month: i % 2 ? '2026-09' : '2026-10', amount: (i % 9) + 0.25,
      receivedAt: i % 11 === 0 ? new Date('2026-09-20T12:00:00.000Z')
        : new Date('2026-10-11T12:00:00.000Z'),
    })) });
    await prisma.entryReceipt.createMany({ data: Array.from({ length: 132 }, (_, i) => ({
      entryId: entries[0]!.id, month: new Date(Date.UTC(2010, i, 1)).toISOString().slice(0, 7),
      amount: 0.01, receivedAt: new Date('2026-10-11T12:00:00.000Z'),
    })) });
    await prisma.expensePayment.createMany({ data: expenses.map((expense, i) => ({
      expenseId: expense.id, month: i % 2 ? '2026-09' : '2026-10', amount: (i % 13) + 0.35,
      paidAt: i % 17 === 0 ? new Date('2026-09-20T12:00:00.000Z')
        : new Date('2026-10-11T12:00:00.000Z'),
    })) });
    await prisma.expensePayment.createMany({ data: Array.from({ length: 132 }, (_, i) => ({
      expenseId: expenses[0]!.id, month: new Date(Date.UTC(2010, i, 1)).toISOString().slice(0, 7),
      amount: 0.02, paidAt: new Date('2026-10-11T12:00:00.000Z'),
    })) });
    await prisma.expenseSplit.createMany({ data: expenses.slice(0, 150).map((expense, i) => ({
      expenseId: expense.id, kind: 'pix' as const, percent: 50, amount: i + 0.11,
    })) });
    const [allEntries, allExpenses, movements] = await Promise.all([
      prisma.entry.findMany({ where: { userId: user.id, systemOrigin: 'manual' },
        include: { salaryHolds: true, receipts: true } }),
      prisma.expense.findMany({ where: { userId: user.id, systemOrigin: 'manual' },
        include: { splits: true, payments: true } }),
      listPiggyCashMovements(user.id),
    ]);
    const reference = calculateMonthlyCash({ today: '2026-10-18', entries: allEntries, expenses: allExpenses, movements });
    const start = performance.now();
    const startHeap = process.memoryUsage().heapUsed;
    const paged = (await getFinancialOverview(user.id, now)).monthly;
    const elapsedMs = performance.now() - start;
    const retainedHeapBytes = Math.max(0, process.memoryUsage().heapUsed - startHeap);
    assert.deepEqual(paged, reference, 'paged reads preserve every receipt/payment and PIX split');
    assert.ok(allEntries.length > 2 * 128 && allExpenses.length > 2 * 128);
    // A generous CI budget catches account-wide materialization and pathological loops;
    // row-level memory is additionally enforced by eachPage's 128-row hard limit.
    assert.ok(elapsedMs < 20_000, `MCP overview exceeded 20s budget: ${elapsedMs.toFixed(0)}ms`);
    assert.ok(retainedHeapBytes < 96 * 1024 * 1024,
      `MCP overview exceeded 96 MiB retained heap budget: ${retainedHeapBytes}`);
  } finally {
    await prisma.expensePayment.deleteMany({ where: { expense: { userId: user.id } } });
    await prisma.entryReceipt.deleteMany({ where: { entry: { userId: user.id } } });
    await prisma.expenseSplit.deleteMany({ where: { expense: { userId: user.id } } });
    await prisma.expense.deleteMany({ where: { userId: user.id } });
    await prisma.entry.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('MCP counts all prepaid recurring payments by paidAt and never charges settled future cycles again', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'MCP advance cash history',
      email: `mcp-prepay-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only',
    },
  });
  try {
    await prisma.expense.create({
      data: {
        userId: user.id,
        name: 'Pagamento mensal antecipado',
        category: 'outro',
        frequency: 'mensal',
        amount: 100,
        dueDay: 10,
        startsAt: new Date('2026-10-01T00:00:00.000Z'),
        paidForMonth: '2026-12',
        payments: { create: [
          { month: '2026-10', amount: 80, paidAt: new Date('2026-10-02T14:00:00.000Z') },
          { month: '2026-11', amount: 90, paidAt: new Date('2026-10-03T14:00:00.000Z') },
          { month: '2026-12', amount: 70, paidAt: new Date('2026-10-04T14:00:00.000Z') },
        ] },
      },
    });
    const october = (await getFinancialOverview(user.id, new Date('2026-10-18T18:00:00.000Z'))).monthly;
    assert.equal(october.expensesBrl, '240.00');
    const november = (await getFinancialOverview(user.id, new Date('2026-11-18T18:00:00.000Z'))).monthly;
    assert.equal(november.expensesBrl, '0.00');
  } finally {
    await prisma.expensePayment.deleteMany({ where: { expense: { userId: user.id } } });
    await prisma.expense.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
