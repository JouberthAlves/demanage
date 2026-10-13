import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { addDaysToKey, weekdayOfKey } from '@/lib/civil-date';
import { interestAccruedThroughOnActivation } from '@/lib/piggy/activation';
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

/** Weekday CDI points for every day of [from, to] (what the provider returns). */
function weekdayPoints(fromKey: string, toKey: string) {
  const points: Array<{ date: string; value: string }> = [];
  for (let key = fromKey; key <= toKey; key = addDaysToKey(key, 1)) {
    const weekday = weekdayOfKey(key);
    if (weekday >= 1 && weekday <= 5) points.push({ date: key, value: '0.05' });
  }
  return points;
}

async function createUser(label: string) {
  return prisma.user.create({
    data: {
      name: label,
      email: `${label}-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });
}

test('enabling yield on an old bank accrues from the activation day, not retroactively', async () => {
  const user = await createUser('yield-activation');
  try {
    // Created months ago with a balance and NO yield (interestAccruedThrough null).
    const bank = await prisma.piggyBank.create({
      data: {
        userId: user.id,
        name: 'Old bank',
        createdAt: new Date('2026-06-01T12:00:00.000Z'),
      },
    });
    await prisma.piggyTransaction.create({
      data: {
        userId: user.id,
        piggyBankId: bank.id,
        type: 'deposit',
        source: 'manual',
        amount: 10_000,
        date: new Date('2026-06-01T12:00:00.000Z'),
      },
    });

    // What updatePiggyBank stores when yield is switched on (Wed 2026-09-16, SP).
    const activatedThrough = interestAccruedThroughOnActivation(
      false,
      true,
      new Date('2026-09-16T15:00:00.000Z'),
    );
    await prisma.piggyBank.update({
      where: { id: bank.id },
      data: {
        yieldEnabled: true,
        cdiPercent: 100,
        interestAccruedThrough: activatedThrough,
      },
    });

    const requested: Array<[string, string]> = [];
    const result = await catchUpPiggyInterest(user.id, {
      now: new Date('2026-09-21T16:00:00.000Z'),
      fetchHistory: async (from, to) => {
        requested.push([from, to]);
        return { provider: 'test', stale: false, points: weekdayPoints(from, to) };
      },
    });

    assert.deepEqual(requested, [['2026-09-16', '2026-09-18']]);
    assert.equal(result.createdCount, 3);
    const interest = await prisma.piggyTransaction.findMany({
      where: { piggyBankId: bank.id, type: 'interest' },
      orderBy: { date: 'asc' },
    });
    assert.deepEqual(
      interest.map((row) => row.date.toISOString().slice(0, 10)),
      ['2026-09-16', '2026-09-17', '2026-09-18'],
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('re-enabling yield after a disabled period pays nothing for the disabled days', async () => {
  const user = await createUser('yield-reenable');
  try {
    // Accrued through 2026-09-14, then disabled; re-enabled on Wed 2026-09-30.
    const bank = await prisma.piggyBank.create({
      data: {
        userId: user.id,
        name: 'Paused yield',
        createdAt: new Date('2026-09-14T12:00:00.000Z'),
        interestAccruedThrough: new Date('2026-09-14T12:00:00.000Z'),
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
    await prisma.piggyBank.update({
      where: { id: bank.id },
      data: {
        yieldEnabled: true,
        cdiPercent: 100,
        interestAccruedThrough: interestAccruedThroughOnActivation(
          false,
          true,
          new Date('2026-09-30T15:00:00.000Z'),
        ),
      },
    });

    const result = await catchUpPiggyInterest(user.id, {
      now: new Date('2026-10-05T16:00:00.000Z'),
      fetchHistory: async (from, to) => ({
        provider: 'test',
        stale: false,
        points: weekdayPoints(from, to),
      }),
    });

    assert.equal(result.createdCount, 3);
    const interest = await prisma.piggyTransaction.findMany({
      where: { piggyBankId: bank.id, type: 'interest' },
      orderBy: { date: 'asc' },
    });
    assert.deepEqual(
      interest.map((row) => row.date.toISOString().slice(0, 10)),
      ['2026-09-30', '2026-10-01', '2026-10-02'],
    );
    assert.ok(interest.every((row) => Number(row.amount) > 0));
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
