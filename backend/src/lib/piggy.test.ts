import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { catchUpPiggyInterest } from '@/lib/piggy-interest';
import { prisma } from '@/lib/prisma';
import {
  currentAutoDebitCycle,
  hasAutoDebitInCycle,
  parseOptionalTargetDate,
  processPiggyAutoDebits,
} from '@/lib/piggy';
import { todayInSaoPaulo } from '@/lib/card-billing';

test('target date accepts today and rejects a past date in São Paulo time', () => {
  const today = todayInSaoPaulo();
  const todayKey = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  assert.equal(parseOptionalTargetDate(todayKey)?.toISOString().slice(0, 10), todayKey);
  assert.throws(
    () => parseOptionalTargetDate(yesterday.toISOString().slice(0, 10)),
    /PAST_TARGET_DATE/,
  );
  assert.throws(() => parseOptionalTargetDate('2026-02-30'), /INVALID_TARGET_DATE/);
});

test('auto-debit catches up an overdue day once and records the due date', () => {
  const now = new Date('2026-09-30T16:00:00.000Z');
  const cycle = currentAutoDebitCycle(
    now,
    new Date('2026-09-01T12:00:00.000Z'),
    5,
  );

  assert.equal(cycle?.dueOn.toISOString(), '2026-09-05T12:00:00.000Z');
  assert.equal(
    currentAutoDebitCycle(
      new Date('2026-09-04T16:00:00.000Z'),
      new Date('2026-09-01T12:00:00.000Z'),
      5,
    ),
    null,
  );
  assert.equal(
    currentAutoDebitCycle(
      now,
      new Date('2026-09-05T12:00:00.000Z'),
      5,
    ),
    null,
  );
});

test('auto-debit idempotency uses the São Paulo calendar month', () => {
  const cycle = currentAutoDebitCycle(
    new Date('2026-09-30T16:00:00.000Z'),
    new Date('2026-09-01T12:00:00.000Z'),
    5,
  );
  assert.ok(cycle);
  assert.equal(
    hasAutoDebitInCycle(
      [
        {
          type: 'deposit',
          source: 'auto_debit',
          date: new Date('2026-10-01T02:30:00.000Z'),
        },
      ],
      cycle,
    ),
    true,
  );
});

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
