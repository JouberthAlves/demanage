/* eslint-disable simple-import-sort/imports -- db-env must run before @/lib/prisma */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssetTransaction } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import { updateAssetTransactionUnderUserLock } from '@/lib/assets';

import {
  mergeAssetTransactionPatch,
  parseAssetTransactionPatch,
} from './assets';

async function assertDisjointPatches(first: 'quantity' | 'cash') {
  const userId = 'owner-1';
  const transactionId = 'asset-1';
  let row = {
    id: transactionId,
    userId,
    asset: 'BTC',
    type: 'BUY',
    quantity: new Prisma.Decimal('1'),
    cashAmountBrl: new Prisma.Decimal('1000'),
    feeAmountBrl: new Prisma.Decimal('0'),
    feePercent: null,
    costBasisKnown: true,
    date: new Date('2026-09-01T12:00:00.000Z'),
    note: null,
    expenseId: 'expense-1',
    entryId: null,
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    updatedAt: new Date('2026-09-01T12:00:00.000Z'),
  } as AssetTransaction;
  let expenseAmount = new Prisma.Decimal('1000');
  let previousWriter: Promise<void> = Promise.resolve();

  const tx = {
    assetTransaction: {
      findFirst: async () => ({ ...row }),
      findMany: async () => [],
      update: async ({ data }: { data: Partial<AssetTransaction> }) => {
        row = { ...row, ...data };
        return { ...row };
      },
    },
    expense: {
      update: async ({ data }: { data: { amount: Prisma.Decimal } }) => {
        expenseAmount = data.amount;
      },
      create: async () => {
        throw new Error('unexpected expense.create');
      },
    },
    entry: {
      deleteMany: async () => {
        throw new Error('unexpected entry.deleteMany');
      },
      create: async () => {
        throw new Error('unexpected entry.create');
      },
    },
  };

  const underLock = async (
    patch: ReturnType<typeof parseAssetTransactionPatch>,
  ) => {
    let release!: () => void;
    const writerFinished = new Promise<void>((resolve) => {
      release = resolve;
    });
    const preceding = previousWriter;
    previousWriter = writerFinished;
    await preceding;
    try {
      return await updateAssetTransactionUnderUserLock(
        tx as unknown as Prisma.TransactionClient,
        userId,
        transactionId,
        (stored) => mergeAssetTransactionPatch(stored, patch),
      );
    } finally {
      release();
    }
  };

  const patches = {
    quantity: parseAssetTransactionPatch({ quantity: '2' }),
    cash: parseAssetTransactionPatch({ cashAmountBrl: '2500' }),
  };
  const second = first === 'quantity' ? 'cash' : 'quantity';
  const changes = await Promise.all([
    underLock(patches[first]),
    underLock(patches[second]),
  ]);
  assert.equal(row.quantity.toString(), '2');
  assert.equal(row.cashAmountBrl.toString(), '2500');
  assert.equal(expenseAmount.toString(), '2500');
  assert.ok(changes.every((change) => change.id === transactionId));
}

test('concurrent partial asset patches keep both fields and linked cash in either order', async () => {
  await assertDisjointPatches('quantity');
  await assertDisjointPatches('cash');
});
