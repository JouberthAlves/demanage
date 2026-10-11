import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { processPiggyAutoDebits } from '@/lib/piggy';
import { catchUpPiggyInterest } from '@/lib/piggy-interest';
import { prisma } from '@/lib/prisma';

// Needs a real PostgreSQL (DATABASE_URL). Pure piggy logic is covered by
// lib/piggy/*.test.ts. Run with: tsx --test src/**/*.itest.ts

test('auto-debit catches up a missed due date once and records that date', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Piggy auto-debit test',
      email: `piggy-auto-debit-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    const bank = await prisma.piggyBank.create({
      data: {
        userId: user.id,
        name: 'Monthly savings',
        monthlyGoal: 50,
        autoDebit: true,
        autoDebitDay: 5,
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    });

    const now = new Date('2026-09-30T16:00:00.000Z');
    assert.deepEqual(await processPiggyAutoDebits(user.id, now), {
      createdCount: 1,
      failedCount: 0,
    });
    assert.deepEqual(await processPiggyAutoDebits(user.id, now), {
      createdCount: 0,
      failedCount: 0,
    });

    const transactions = await prisma.piggyTransaction.findMany({
      where: { piggyBankId: bank.id },
    });
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].source, 'auto_debit');
    assert.equal(transactions[0].date.toISOString(), '2026-09-05T12:00:00.000Z');
    assert.equal(Number(transactions[0].amount), 50);
    const expense = await prisma.expense.findUniqueOrThrow({
      where: { id: transactions[0].expenseId! },
    });
    assert.equal(expense.occurredAt?.toISOString(), '2026-09-05T12:00:00.000Z');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('overdue auto-debit is applied before CDI catch-up for its effective date', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Auto debit CDI test',
      email: `piggy-auto-cdi-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    const bank = await prisma.piggyBank.create({
      data: {
        userId: user.id,
        name: 'Yield savings',
        autoDebit: true,
        autoDebitDay: 5,
        monthlyGoal: 100,
        yieldEnabled: true,
        cdiPercent: 100,
        createdAt: new Date('2026-09-01T12:00:00.000Z'),
      },
    });
    const now = new Date('2026-09-30T16:00:00.000Z');

    const interest = await catchUpPiggyInterest(user.id, {
      now,
      fetchHistory: async () => ({
        provider: 'test',
        stale: false,
        points: [
          { date: '2026-09-04', value: '0.1' },
          { date: '2026-09-08', value: '0.1' },
        ],
      }),
    });

    assert.deepEqual(interest, {
      createdCount: 1,
      stale: false,
      autoDebitCreatedCount: 1,
      autoDebitFailedCount: 0,
    });
    const earned = await prisma.piggyTransaction.findFirstOrThrow({
      where: { piggyBankId: bank.id, type: 'interest' },
    });
    assert.equal(earned.date.toISOString(), '2026-09-08T12:00:00.000Z');
    assert.equal(Number(earned.baseBalance), 100);
    assert.equal(Number(earned.amount), 0.1);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('auto-debit back-fills every missed month once and stays idempotent', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Piggy missed cycles test',
      email: `piggy-missed-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    const bank = await prisma.piggyBank.create({
      data: {
        userId: user.id,
        name: 'Monthly savings',
        monthlyGoal: 50,
        autoDebit: true,
        autoDebitDay: 5,
        createdAt: new Date('2026-07-01T12:00:00.000Z'),
      },
    });

    const now = new Date('2026-09-30T16:00:00.000Z');
    assert.deepEqual(await processPiggyAutoDebits(user.id, now), {
      createdCount: 3,
      failedCount: 0,
    });
    assert.deepEqual(await processPiggyAutoDebits(user.id, now), {
      createdCount: 0,
      failedCount: 0,
    });

    const transactions = await prisma.piggyTransaction.findMany({
      where: { piggyBankId: bank.id },
      orderBy: { date: 'asc' },
    });
    assert.deepEqual(
      transactions.map((transaction) => transaction.date.toISOString().slice(0, 10)),
      ['2026-07-05', '2026-08-05', '2026-09-05'],
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('auto-debit enabled in October does not back-fill the months since creation', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Piggy auto-debit enabled test',
      email: `piggy-auto-debit-enabled-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    const bank = await prisma.piggyBank.create({
      data: {
        userId: user.id,
        name: 'Enabled late',
        monthlyGoal: 50,
        autoDebit: true,
        autoDebitDay: 5,
        autoDebitEnabledAt: new Date('2026-10-02T15:00:00.000Z'),
        createdAt: new Date('2026-01-10T12:00:00.000Z'),
      },
    });

    const now = new Date('2026-10-20T16:00:00.000Z');
    assert.deepEqual(await processPiggyAutoDebits(user.id, now), {
      createdCount: 1,
      failedCount: 0,
    });
    const transactions = await prisma.piggyTransaction.findMany({
      where: { piggyBankId: bank.id },
    });
    assert.deepEqual(
      transactions.map((row) => row.date.toISOString()),
      ['2026-10-05T12:00:00.000Z'],
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
