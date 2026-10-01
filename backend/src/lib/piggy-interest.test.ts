import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { decimal } from '@/lib/decimal';
import {
  calculateCdiInterest,
  catchUpPiggyInterest,
  lastCompletedWeekday,
  splitCdiHistoryRange,
} from '@/lib/piggy-interest';
import { prisma } from '@/lib/prisma';
import {
  MAX_HISTORY_RANGE_DAYS,
  validateHistoryRange,
} from '@/lib/market-data';

test('rendimento diário usa CDI bruto proporcional ao percentual do cofrinho', () => {
  const interest = calculateCdiInterest(
    decimal('10000'),
    decimal('0.04'),
    decimal('100'),
  );
  assert.equal(interest.toFixed(2), '4.00');
});

test('cofrinho 120% CDI multiplica a taxa diária sem aplicar imposto', () => {
  const interest = calculateCdiInterest(
    decimal('10000'),
    decimal('0.04'),
    decimal('120'),
  );
  assert.equal(interest.toFixed(2), '4.80');
});

test('percentual zero não inventa rendimento', () => {
  const interest = calculateCdiInterest(
    decimal('10000'),
    decimal('0.04'),
    decimal('0'),
  );
  assert.equal(interest.toFixed(2), '0.00');
});

test('catch-up nunca depende do CDI do dia ainda em andamento', () => {
  assert.equal(
    lastCompletedWeekday(new Date('2026-08-21T18:00:00Z'))
      .toISOString()
      .slice(0, 10),
    '2026-08-20',
  );
});

test('fim de semana usa a sexta-feira como último dia concluído', () => {
  assert.equal(
    lastCompletedWeekday(new Date('2026-08-24T12:00:00Z'))
      .toISOString()
      .slice(0, 10),
    '2026-08-21',
  );
});

test('data de catch-up segue o dia civil de São Paulo perto da meia-noite UTC', () => {
  assert.equal(
    lastCompletedWeekday(new Date('2026-01-01T01:00:00.000Z'))
      .toISOString()
      .slice(0, 10),
    '2025-12-30',
  );
});

test('catch-up divide histórico CDI longo em janelas compatíveis com o limite', () => {
  const ranges = splitCdiHistoryRange(
    new Date('2010-01-01T12:00:00.000Z'),
    new Date('2026-09-28T12:00:00.000Z'),
  );

  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].from, '2010-01-01');
  assert.equal(ranges.at(-1)?.to, '2026-09-28');
  for (const range of ranges) {
    const elapsedDays =
      (new Date(`${range.to}T12:00:00Z`).getTime() -
        new Date(`${range.from}T12:00:00Z`).getTime()) /
      86_400_000;
    assert.ok(elapsedDays + 1 <= MAX_HISTORY_RANGE_DAYS);
    assert.doesNotThrow(() =>
      validateHistoryRange(
        range.from,
        range.to,
        new Date('2026-09-29T12:00:00Z'),
      ),
    );
  }
});

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
