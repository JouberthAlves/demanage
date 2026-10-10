import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { catchUpPiggyInterest } from '@/lib/piggy-interest';
import { prisma } from '@/lib/prisma';

// Needs a real PostgreSQL (DATABASE_URL). Pure interest logic is covered by
// lib/piggy/interest.test.ts. Run with: tsx --test src/**/*.itest.ts

test('CDI catch-up records the prior percentage before a settings change', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'CDI history test',
      email: `cdi-history-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    const bank = await prisma.piggyBank.create({
      data: {
        userId: user.id,
        name: 'Yield savings',
        yieldEnabled: true,
        cdiPercent: 100,
        interestAccruedThrough: new Date('2026-09-14T12:00:00.000Z'),
        createdAt: new Date('2026-09-14T12:00:00.000Z'),
      },
    });
    await prisma.piggyTransaction.create({
      data: {
        userId: user.id,
        piggyBankId: bank.id,
        type: 'deposit',
        source: 'manual',
        amount: 10_000,
        date: new Date('2026-09-14T12:00:00.000Z'),
      },
    });

    const requestedRanges: Array<[string, string]> = [];
    const result = await catchUpPiggyInterest(user.id, {
      now: new Date('2026-09-21T16:00:00.000Z'),
      fetchHistory: async (from, to) => {
        requestedRanges.push([from, to]);
        return {
          provider: 'test',
          stale: false,
          points: [
            '2026-09-15',
            '2026-09-16',
            '2026-09-17',
            '2026-09-18',
          ].map((date) => ({ date, value: '0.05' })),
        };
      },
    });

    assert.deepEqual(requestedRanges, [['2026-09-15', '2026-09-18']]);
    assert.deepEqual(result, {
      createdCount: 4,
      stale: false,
      autoDebitCreatedCount: 0,
      autoDebitFailedCount: 0,
    });
    const historicalInterest = await prisma.piggyTransaction.findMany({
      where: { piggyBankId: bank.id, type: 'interest' },
      orderBy: { date: 'asc' },
    });
    assert.equal(historicalInterest.length, 4);
    assert.ok(historicalInterest.every((transaction) => Number(transaction.cdiPercent) === 100));

    await prisma.piggyBank.update({
      where: { id: bank.id },
      data: { cdiPercent: 200 },
    });
    const persistedHistory = await prisma.piggyTransaction.findMany({
      where: { piggyBankId: bank.id, type: 'interest' },
    });
    assert.ok(persistedHistory.every((transaction) => Number(transaction.cdiPercent) === 100));
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('sub-cent interest is carried across runs instead of being rounded away', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'CDI carry test',
      email: `cdi-carry-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    const bank = await prisma.piggyBank.create({
      data: {
        userId: user.id,
        name: 'Small savings',
        yieldEnabled: true,
        cdiPercent: 100,
        interestAccruedThrough: new Date('2026-09-14T12:00:00.000Z'),
        createdAt: new Date('2026-09-14T12:00:00.000Z'),
      },
    });
    await prisma.piggyTransaction.create({
      data: {
        userId: user.id,
        piggyBankId: bank.id,
        type: 'deposit',
        source: 'manual',
        amount: 5,
        date: new Date('2026-09-14T12:00:00.000Z'),
      },
    });

    const fetchHistory = async (from: string, to: string) => ({
      provider: 'test',
      stale: false,
      points: ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']
        .filter((date) => date >= from && date <= to)
        .map((date) => ({ date, value: '0.055131' })),
    });
    // R$5 * 0.055131% = R$0.0027/day: no whole cent on day 1, one by day 4.
    await catchUpPiggyInterest(user.id, {
      now: new Date('2026-09-21T16:00:00.000Z'),
      fetchHistory,
    });
    const interest = await prisma.piggyTransaction.findMany({
      where: { piggyBankId: bank.id, type: 'interest' },
    });
    assert.equal(interest.length, 1);
    assert.equal(Number(interest[0].amount), 0.01);
    assert.ok(Number(interest[0].resultingBalance) > 5.01);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
