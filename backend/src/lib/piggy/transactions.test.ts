/* eslint-disable simple-import-sort/imports -- db-env must initialize before Prisma imports */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Prisma } from '@/generated/prisma/client';
import { decimal } from '@/lib/decimal';

import { depositToPiggyBankInTransaction } from './transactions';

function fakeTransaction() {
  const expenses: Record<string, unknown>[] = [];
  const deposits: Record<string, unknown>[] = [];
  const bank = {
    id: 'bank-1',
    name: 'Reserva',
    goalAmount: decimal('1000'),
    archivedAt: null,
    completedAt: null,
    transactions: [],
  };
  const tx = {
    piggyBank: {
      findFirst: async () => bank,
      update: async () => bank,
    },
    expense: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        expenses.push(data);
        return { id: 'expense-1' };
      },
    },
    piggyTransaction: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        deposits.push(data);
        return { id: 'deposit-1', ...data };
      },
    },
  } as unknown as Prisma.TransactionClient;

  return { tx, expenses, deposits };
}

const base = {
  userId: 'user-1',
  piggyBankId: 'bank-1',
  amount: 100,
  date: new Date('2026-10-13T12:00:00.000Z'),
};

test('manual deposit keeps creating an expense by default', async () => {
  const { tx, expenses, deposits } = fakeTransaction();
  const result = await depositToPiggyBankInTransaction(tx, base);

  assert.equal(expenses.length, 1);
  assert.equal(expenses[0].category, 'cofrinho');
  assert.equal(deposits[0].expenseId, 'expense-1');
  assert.equal(result.depositAmount, 100);
});

test('manual deposit can skip the expense without skipping the piggy deposit', async () => {
  const { tx, expenses, deposits } = fakeTransaction();
  const result = await depositToPiggyBankInTransaction(tx, {
    ...base,
    deductFromBalance: false,
  });

  assert.equal(expenses.length, 0);
  assert.equal(deposits.length, 1);
  assert.equal(deposits[0].expenseId, null);
  assert.equal(result.depositAmount, 100);
});

test('automatic deposits cannot opt out of their scheduled debit', async () => {
  const { tx, expenses, deposits } = fakeTransaction();
  await depositToPiggyBankInTransaction(tx, {
    ...base,
    source: 'auto_debit',
    deductFromBalance: false,
  });

  assert.equal(expenses.length, 1);
  assert.equal(deposits[0].expenseId, 'expense-1');
});
