import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

import { createReceivedOneTimeIncomeInTransaction } from './received-income';

test('received gift creates a one-time entry and a matching paid receipt', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'MCP gift test',
      email: `mcp-gift-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only',
    },
  });
  try {
    const ids = await withUserWriteLockTransaction(user.id, (tx) =>
      createReceivedOneTimeIncomeInTransaction(tx, user.id, {
        amountCents: 2_000,
        dateKey: '2026-10-16',
        name: 'Presente',
        notes: 'Presente da minha vó',
        tagId: null,
      }),
    );

    const entry = await prisma.entry.findUniqueOrThrow({
      where: { id: ids.entryId },
      include: { receipts: true },
    });
    assert.equal(entry.userId, user.id);
    assert.equal(entry.name, 'Presente');
    assert.equal(entry.notes, 'Presente da minha vó');
    assert.equal(entry.type, 'outro');
    assert.equal(entry.frequency, 'unica');
    assert.equal(Number(entry.amount), 20);
    assert.equal(entry.receipts.length, 1);
    assert.equal(entry.receipts[0].id, ids.receiptId);
    assert.equal(entry.receipts[0].month, '2026-10');
    assert.equal(Number(entry.receipts[0].amount), 20);
    assert.equal(entry.receipts[0].receivedAt.toISOString().slice(0, 10), '2026-10-16');

    await assert.rejects(
      withUserWriteLockTransaction(user.id, async (tx) => {
        await createReceivedOneTimeIncomeInTransaction(tx, user.id, {
          amountCents: 500,
          dateKey: '2026-10-16',
          name: 'Should roll back',
          notes: null,
          tagId: null,
        });
        throw new Error('simulate failure later in same operation');
      }),
      /simulate failure/,
    );
    assert.equal(
      await prisma.entry.count({ where: { userId: user.id } }),
      1,
    );
    assert.equal(
      await prisma.entryReceipt.count({ where: { entry: { userId: user.id } } }),
      1,
    );
  } finally {
    await prisma.entryReceipt.deleteMany({ where: { entry: { userId: user.id } } });
    await prisma.entry.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
