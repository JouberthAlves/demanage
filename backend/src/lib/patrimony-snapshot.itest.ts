import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { readPatrimonySnapshot } from '@/lib/patrimony-snapshot';
import { prisma } from '@/lib/prisma';

// Runs only in the isolated PostgreSQL integration suite. The first SELECT
// pins the reader's snapshot; the writer then commits both transfer rows.
test('patrimony read uses one PostgreSQL snapshot across an intervening transfer', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Snapshot test',
      email: `snapshot-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  try {
    await prisma.patrimonySettings.create({
      data: {
        userId: user.id,
        baseDate: new Date('2026-01-01T12:00:00.000Z'),
        openingCashBrl: '1000',
      },
    });

    const reader = {
      $transaction: (
        operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options: {
          isolationLevel: Prisma.TransactionIsolationLevel;
          maxWait: number;
          timeout: number;
        },
      ) =>
        prisma.$transaction(async (tx) => {
          // Establish this transaction's MVCC snapshot before a concurrent
          // writer commits; SELECT does not block the writer.
          await tx.patrimonySettings.findUnique({ where: { userId: user.id } });
          await prisma.$transaction(async (writer) => {
            await writer.patrimonySettings.update({
              where: { userId: user.id },
              data: { openingCashBrl: '900' },
            });
            const expense = await writer.expense.create({
              data: {
                userId: user.id,
                name: 'Asset buy',
                amount: '100',
                category: 'outro',
                frequency: 'unica',
                occurredAt: new Date('2026-01-02T12:00:00.000Z'),
              },
            });
            await writer.assetTransaction.create({
              data: {
                userId: user.id,
                asset: 'USD',
                type: 'BUY',
                quantity: '20',
                cashAmountBrl: '100',
                date: new Date('2026-01-02T12:00:00.000Z'),
                expenseId: expense.id,
              },
            });
          });
          return operation(tx);
        }, options),
    } as unknown as PrismaClient;

    const before = await readPatrimonySnapshot(reader, user.id);
    assert.equal(before.settings.openingCashBrl.toString(), '1000');
    assert.equal(before.expenses.length, 0);
    assert.equal(before.assetTransactions.length, 0);

    const after = await readPatrimonySnapshot(prisma, user.id);
    assert.equal(after.settings.openingCashBrl.toString(), '900');
    assert.equal(after.expenses.length, 1);
    assert.equal(after.assetTransactions.length, 1);
    assert.equal(after.assetTransactions[0].expenseId, after.expenses[0].id);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
