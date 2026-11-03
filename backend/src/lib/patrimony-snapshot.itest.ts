import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import type { Prisma, PrismaClient } from '@/generated/prisma/client';
import { readPatrimonySnapshot } from '@/lib/patrimony-snapshot';
import { prisma } from '@/lib/prisma';

test('patrimony excludes voided mistaken expense but retains older archived paid expense', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Voided patrimony verification',
      email: `voided-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });
  try {
    await prisma.patrimonySettings.create({
      data: { userId: user.id, baseDate: new Date('2026-01-01T12:00:00Z'), openingCashBrl: '500' },
    });
    const old = new Date('2026-10-09T12:00:00Z');
    for (const [name, voidedAt] of [
      ['Prior legitimate archived expense', null],
      ['Wrong purchase deleted by user', new Date('2026-11-02T12:00:00Z')],
    ] as const) {
      const expense = await prisma.expense.create({
        data: {
          userId: user.id, name, amount: 85,
          category: 'outro', frequency: 'unica',
          occurredAt: old, archivedAt: new Date('2026-11-02T12:00:00Z'), voidedAt,
        },
      });
      await prisma.expensePayment.create({
        data: { expenseId: expense.id, month: '2026-10', amount: 85, paidAt: old },
      });
    }
    const snapshot = await readPatrimonySnapshot(prisma, user.id);
    assert.deepEqual(snapshot.expenses.map((expense) => expense.name), ['Prior legitimate archived expense']);
    assert.equal(snapshot.expenses[0].payments.length, 1);
  } finally {
    const expenses = await prisma.expense.findMany({ where: { userId: user.id }, select: { id: true } });
    await prisma.expensePayment.deleteMany({ where: { expenseId: { in: expenses.map((expense) => expense.id) } } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

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
