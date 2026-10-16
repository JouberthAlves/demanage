import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

import { runFinanceOperationInTransaction } from './finance-operation';

async function createTestUser() {
  return prisma.user.create({
    data: {
      name: 'Finance MCP operation test',
      email: `finance-mcp-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-login',
    },
  });
}

async function removeTestUser(userId: string) {
  const entries = await prisma.entry.findMany({ where: { userId }, select: { id: true } });
  await prisma.entryReceipt.deleteMany({ where: { entryId: { in: entries.map((x) => x.id) } } });
  await prisma.piggyTransaction.deleteMany({ where: { userId } });
  await prisma.expense.deleteMany({ where: { userId } });
  await prisma.entry.deleteMany({ where: { userId } });
  await prisma.piggyBank.deleteMany({ where: { userId } });
  await prisma.customTag.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

test('gift plus saving writes +R$20 income, -R$20 cash expense and +R$20 piggy atomically', async () => {
  const user = await createTestUser();
  const bank = await prisma.piggyBank.create({
    data: { userId: user.id, name: 'Porco', monthlyGoal: 0 },
  });
  try {
    const result = await withUserWriteLockTransaction(user.id, (tx) =>
      runFinanceOperationInTransaction(tx, user.id, {
        kind: 'receive_and_save',
        amountCents: 2_000,
        dateKey: '2026-10-16',
        description: 'Presente da minha vó',
        tagName: 'Presente',
        bankId: bank.id,
      }),
    );
    assert.equal(result.amountCents, 2_000);
    assert.ok(result.entryId);
    assert.ok(result.receiptId);
    assert.ok(result.piggyTransactionId);
    const entries = await prisma.entry.findMany({
      where: { userId: user.id },
      include: { receipts: true, customTag: true },
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].customTag?.name, 'Presente');
    assert.equal(entries[0].notes, 'Presente da minha vó');
    assert.equal(entries[0].receipts.length, 1);
    assert.equal(Number(entries[0].receipts[0].amount), 20);
    const expenses = await prisma.expense.findMany({ where: { userId: user.id } });
    assert.equal(expenses.length, 1);
    assert.equal(Number(expenses[0].amount), 20);
    assert.equal(expenses[0].systemOrigin, 'piggy');
    const deposits = await prisma.piggyTransaction.findMany({ where: { userId: user.id } });
    assert.equal(deposits.length, 1);
    assert.equal(Number(deposits[0].amount), 20);
    assert.equal(deposits[0].expenseId, expenses[0].id);
  } finally {
    await removeTestUser(user.id);
  }
});

test('income-only gift creates no piggy expense or transfer', async () => {
  const user = await createTestUser();
  try {
    const result = await withUserWriteLockTransaction(user.id, (tx) =>
      runFinanceOperationInTransaction(tx, user.id, {
        kind: 'receive_income',
        amountCents: 2_000,
        dateKey: '2026-10-16',
        description: 'Presente da minha vó',
        tagName: 'Presente',
      }),
    );
    assert.ok(result.entryId);
    assert.equal(result.piggyTransactionId, null);
    assert.equal(await prisma.expense.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.entryReceipt.count({ where: { entry: { userId: user.id } } }), 1);
  } finally {
    await removeTestUser(user.id);
  }
});

test('capped piggy or a foreign bank fully rolls back an income and tag', async () => {
  const user = await createTestUser();
  const other = await createTestUser();
  const bank = await prisma.piggyBank.create({
    data: { userId: user.id, name: 'Porco', monthlyGoal: 0, goalAmount: 8 },
  });
  const otherBank = await prisma.piggyBank.create({
    data: { userId: other.id, name: 'Porco', monthlyGoal: 0 },
  });
  try {
    for (const bankId of [bank.id, otherBank.id]) {
      await assert.rejects(
        withUserWriteLockTransaction(user.id, (tx) =>
          runFinanceOperationInTransaction(tx, user.id, {
            kind: 'receive_and_save',
            amountCents: 2_000,
            dateKey: '2026-10-16',
            description: 'Presente da minha vó',
            tagName: 'Presente',
            bankId,
          }),
        ),
      );
      assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 0);
      assert.equal(await prisma.customTag.count({ where: { userId: user.id } }), 0);
      assert.equal(await prisma.piggyTransaction.count({ where: { userId: user.id } }), 0);
      assert.equal(await prisma.expense.count({ where: { userId: user.id } }), 0);
    }
  } finally {
    await removeTestUser(user.id);
    await removeTestUser(other.id);
  }
});

test('deposit of existing cash requires an explicit deduction flag', async () => {
  const user = await createTestUser();
  const bank = await prisma.piggyBank.create({ data: { userId: user.id, name: 'Porco', monthlyGoal: 0 } });
  try {
    await assert.rejects(
      withUserWriteLockTransaction(user.id, (tx) =>
        runFinanceOperationInTransaction(tx, user.id, {
          kind: 'deposit_existing_cash',
          amountCents: 2_000,
          dateKey: '2026-10-16',
          bankId: bank.id,
          note: null,
        } as never),
      ),
    );
    assert.equal(await prisma.piggyTransaction.count({ where: { userId: user.id } }), 0);
  } finally {
    await removeTestUser(user.id);
  }
});
