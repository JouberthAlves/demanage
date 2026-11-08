import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { AppError } from '@/http/errors';
import { hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { deleteAccount } from './auth';

const PASSWORD = 'DeleteAccount123!';

async function seedUserWithLedger() {
  const user = await prisma.user.create({
    data: {
      name: 'Account deletion',
      email: `delete-${randomUUID()}@example.invalid`,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  const card = await prisma.card.create({
    data: { userId: user.id, name: 'Cartão', closingDay: 5 },
  });
  const expense = await prisma.expense.create({
    data: {
      userId: user.id,
      cardId: card.id,
      name: 'Streaming',
      amount: '40.00',
      category: 'assinatura',
      dueDay: 10,
      splits: {
        create: { kind: 'card', cardId: card.id, percent: '100', amount: '40.00' },
      },
      payments: {
        create: { month: '2026-10', amount: '40.00', paidAt: new Date() },
      },
    },
  });
  const entry = await prisma.entry.create({
    data: {
      userId: user.id,
      name: 'Salário',
      amount: '3000.00',
      type: 'salario',
      frequency: 'mensal',
      receiveDay: 5,
      receipts: {
        create: { month: '2026-10', amount: '3000.00', receivedAt: new Date() },
      },
      salaryVersions: {
        create: { month: '2026-10', amount: '3000.00', receiveDay: 5 },
      },
      salaryHolds: { create: { month: '2026-11' } },
    },
  });
  const piggy = await prisma.piggyBank.create({
    data: { userId: user.id, name: 'Reserva' },
  });
  await prisma.piggyTransaction.create({
    data: {
      piggyBankId: piggy.id,
      userId: user.id,
      type: 'deposit',
      amount: '100.00',
      date: new Date(),
      expenseId: expense.id,
    },
  });
  // A debited correction needs entryId NOT NULL: a cascade SET NULL from the
  // Entry would violate the CHECK, so deletion must remove it first.
  await prisma.piggyTransaction.create({
    data: {
      piggyBankId: piggy.id,
      userId: user.id,
      type: 'withdraw',
      source: 'manual',
      amount: '10.00',
      date: new Date(),
      entryId: entry.id,
      correctionOrigin: 'debited',
    },
  });
  return user;
}

test('PostgreSQL deletes the account and every owned ledger row', async () => {
  const user = await seedUserWithLedger();
  const bystander = await seedUserWithLedger();

  try {
    await deleteAccount(user.id, PASSWORD);

    assert.equal(await prisma.user.count({ where: { id: user.id } }), 0);
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.expense.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.card.count({ where: { userId: user.id } }), 0);
    assert.equal(
      await prisma.piggyTransaction.count({ where: { userId: user.id } }),
      0,
    );

    // Another account's data stays untouched.
    assert.equal(await prisma.user.count({ where: { id: bystander.id } }), 1);
    assert.equal(
      await prisma.entryReceipt.count({ where: { entry: { userId: bystander.id } } }),
      1,
    );
    assert.equal(
      await prisma.piggyTransaction.count({ where: { userId: bystander.id } }),
      2,
    );
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } });
    await deleteAccount(bystander.id, PASSWORD);
  }
});

test('PostgreSQL keeps the account when the password is wrong', async () => {
  const user = await seedUserWithLedger();

  try {
    await assert.rejects(
      deleteAccount(user.id, 'WrongPassword123!'),
      (error) => error instanceof AppError && error.status === 403,
    );
    const kept = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(kept.sessionVersion, user.sessionVersion);
    assert.equal(
      await prisma.expensePayment.count({ where: { expense: { userId: user.id } } }),
      1,
    );
  } finally {
    await deleteAccount(user.id, PASSWORD);
  }
});
