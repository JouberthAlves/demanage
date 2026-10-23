import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { processUserCardBilling } from '@/lib/card-billing';
import { todayKeyInSaoPaulo } from '@/lib/civil-date';
import { prisma } from '@/lib/prisma';

import { parseCreateExpense, parseUpdateExpense } from './expense-input';
import { createExpense, payExpense, updateExpense } from './expenses';

const day = todayKeyInSaoPaulo();
const [year, month] = day.split('-').map(Number);
const afterCurrentClosing = new Date(Date.UTC(year, month, 2, 16));

async function createTestUser() {
  return prisma.user.create({
    data: {
      name: 'F01 one-off accounting',
      email: `expense-f01-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });
}

async function cleanup(userId: string) {
  const expenses = await prisma.expense.findMany({
    where: { userId },
    select: { id: true },
  });
  const ids = expenses.map((expense) => expense.id);
  await prisma.expensePayment.deleteMany({ where: { expenseId: { in: ids } } });
  await prisma.expenseSplit.deleteMany({ where: { expenseId: { in: ids } } });
  await prisma.expense.deleteMany({ where: { userId } });
  await prisma.card.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

async function createTestCard(userId: string, name: string) {
  return prisma.card.create({
    data: { userId, name, closingDay: 31 },
  });
}

test('F01: a settled PIX one-off cannot be moved to card or repriced; descriptive edit preserves one payment', async () => {
  const user = await createTestUser();
  try {
    const card = await createTestCard(user.id, 'PIX change target');
    const expense = await createExpense(
      user.id,
      parseCreateExpense({
        name: 'Pago via PIX',
        amount: 100,
        category: 'outro',
        frequency: 'unica',
        date: day,
      }),
    );

    for (const change of [
      { amount: 200 },
      { cardId: card.id },
      {
        splits: [
          { kind: 'pix', percent: 50 },
          { kind: 'card', cardId: card.id, percent: 50 },
        ],
      },
    ]) {
      await assert.rejects(
        () => updateExpense(user.id, expense.id, parseUpdateExpense(change)),
        /pagamento registrado/,
      );
    }

    const renamed = await updateExpense(
      user.id,
      expense.id,
      parseUpdateExpense({ name: 'Novo nome', notes: 'mesma compra' }),
    );
    assert.equal(renamed.name, 'Novo nome');
    await updateExpense(
      user.id,
      expense.id,
      parseUpdateExpense({
        amount: 100,
      }),
    );
    assert.equal(Number(renamed.amount), 100);
    assert.equal(renamed.cardId, null);
    assert.deepEqual(
      (
        await prisma.expensePayment.findMany({
          where: { expenseId: expense.id },
        })
      ).map((payment) => Number(payment.amount)),
      [100],
    );
    assert.deepEqual(
      await processUserCardBilling(user.id, afterCurrentClosing),
      {
        createdCount: 0,
      },
    );
  } finally {
    await cleanup(user.id);
  }
});

test('F01: a paid recurring PIX expense cannot turn into one-off and duplicate its paid cycle', async () => {
  const user = await createTestUser();
  try {
    const expense = await createExpense(
      user.id,
      parseCreateExpense({
        name: 'Recorrência quitada',
        amount: 90,
        category: 'outro',
        frequency: 'mensal',
        startsAt: day,
        dueDay: Number(day.slice(-2)),
      }),
    );
    const paidMonth = day.slice(0, 7);
    await payExpense(user.id, expense.id, paidMonth);
    await assert.rejects(
      () =>
        updateExpense(
          user.id,
          expense.id,
          parseUpdateExpense({ frequency: 'unica', date: day }),
        ),
      /pagamento registrado/,
    );
    const persisted = await prisma.expense.findUniqueOrThrow({
      where: { id: expense.id },
    });
    assert.equal(persisted.frequency, 'mensal');
    assert.deepEqual(
      (
        await prisma.expensePayment.findMany({
          where: { expenseId: expense.id },
        })
      ).map((payment) => Number(payment.amount)),
      [90],
    );
  } finally {
    await cleanup(user.id);
  }
});

test('F01: settled split PIX + billed card cannot change amount, split, card or frequency', async () => {
  const user = await createTestUser();
  try {
    const card = await createTestCard(user.id, 'Charged card');
    const otherCard = await createTestCard(user.id, 'New card');
    const expense = await createExpense(
      user.id,
      parseCreateExpense({
        name: 'Split realizado',
        amount: 100,
        category: 'outro',
        frequency: 'unica',
        date: day,
        splits: [
          { kind: 'pix', percent: 40 },
          { kind: 'card', cardId: card.id, percent: 60 },
        ],
      }),
    );

    assert.deepEqual(
      await processUserCardBilling(user.id, afterCurrentClosing),
      {
        createdCount: 1,
      },
    );
    const invoice = await prisma.expense.findFirstOrThrow({
      where: { userId: user.id, isInvoice: true },
    });
    assert.equal(Number(invoice.amount), 60);
    const invoiceMonth = invoice.billingPeriodEnd!.toISOString().slice(0, 7);
    await payExpense(user.id, invoice.id, invoiceMonth);

    for (const change of [
      { amount: 200 },
      {
        splits: [
          { kind: 'pix', percent: 50 },
          { kind: 'card', cardId: card.id, percent: 50 },
        ],
      },
      {
        splits: [
          { kind: 'pix', percent: 40 },
          { kind: 'card', cardId: otherCard.id, percent: 60 },
        ],
      },
      { frequency: 'mensal', startsAt: day, dueDay: 23 },
    ]) {
      await assert.rejects(
        () => updateExpense(user.id, expense.id, parseUpdateExpense(change)),
        /pagamento registrado/,
      );
    }

    await updateExpense(
      user.id,
      expense.id,
      parseUpdateExpense({ name: 'Split renomeado' }),
    );
    const payments = await prisma.expensePayment.findMany({
      where: { expenseId: expense.id },
    });
    const invoicePayments = await prisma.expensePayment.findMany({
      where: { expenseId: invoice.id },
    });
    assert.deepEqual(
      payments.map((p) => Number(p.amount)),
      [40],
    );
    assert.deepEqual(
      invoicePayments.map((p) => Number(p.amount)),
      [60],
    );
    assert.deepEqual(
      await processUserCardBilling(user.id, afterCurrentClosing),
      {
        createdCount: 0,
      },
    );
  } finally {
    await cleanup(user.id);
  }
});

test('F01: card-only one-off can gain PIX before closing with one atomic cash payment', async () => {
  const user = await createTestUser();
  try {
    const card = await createTestCard(user.id, 'Unbilled card');
    const expense = await createExpense(
      user.id,
      parseCreateExpense({
        name: 'Compra do dia',
        amount: 100,
        category: 'outro',
        frequency: 'unica',
        date: day,
        cardId: card.id,
      }),
    );
    const change = parseUpdateExpense({
      splits: [
        { kind: 'pix', percent: 30 },
        { kind: 'card', cardId: card.id, percent: 70 },
      ],
    });
    await updateExpense(user.id, expense.id, change);
    await updateExpense(user.id, expense.id, change);

    assert.deepEqual(
      (
        await prisma.expensePayment.findMany({
          where: { expenseId: expense.id },
        })
      ).map((payment) => Number(payment.amount)),
      [30],
    );
    assert.deepEqual(
      await processUserCardBilling(user.id, afterCurrentClosing),
      {
        createdCount: 1,
      },
    );
    const invoices = await prisma.expense.findMany({
      where: { userId: user.id, isInvoice: true },
    });
    assert.deepEqual(
      invoices.map((invoice) => Number(invoice.amount)),
      [70],
    );
    await assert.rejects(
      () =>
        updateExpense(user.id, expense.id, parseUpdateExpense({ amount: 120 })),
      /pagamento registrado/,
    );
    assert.deepEqual(
      await processUserCardBilling(user.id, afterCurrentClosing),
      {
        createdCount: 0,
      },
    );
  } finally {
    await cleanup(user.id);
  }
});

test('F01: a billed card-only one-off remains immutable even with no cash payment', async () => {
  const user = await createTestUser();
  try {
    const card = await createTestCard(user.id, 'Paid billing card');
    const otherCard = await createTestCard(user.id, 'Other billing card');
    const expense = await createExpense(
      user.id,
      parseCreateExpense({
        name: 'Somente cartão',
        amount: 100,
        category: 'outro',
        frequency: 'unica',
        date: day,
        cardId: card.id,
      }),
    );
    assert.deepEqual(
      await processUserCardBilling(user.id, afterCurrentClosing),
      {
        createdCount: 1,
      },
    );
    assert.deepEqual(
      await prisma.expensePayment.findMany({
        where: { expenseId: expense.id },
      }),
      [],
    );

    for (const change of [
      { amount: 110 },
      { cardId: otherCard.id },
      {
        splits: [
          { kind: 'pix', percent: 50 },
          { kind: 'card', cardId: otherCard.id, percent: 50 },
        ],
      },
    ]) {
      await assert.rejects(
        () => updateExpense(user.id, expense.id, parseUpdateExpense(change)),
        /faturada/,
      );
    }
    const renamed = await updateExpense(
      user.id,
      expense.id,
      parseUpdateExpense({ name: 'Nome ajustado' }),
    );
    assert.equal(renamed.name, 'Nome ajustado');
    assert.equal(Number(renamed.amount), 100);
    assert.equal(
      await prisma.expense.count({
        where: { userId: user.id, isInvoice: true },
      }),
      1,
    );
  } finally {
    await cleanup(user.id);
  }
});
