import assert from 'node:assert/strict';
import test from 'node:test';

import type { PrismaClient } from '@/generated/prisma/client';
import { readPatrimonySnapshot } from '@/lib/patrimony-snapshot';

test('a concurrent atomic transfer cannot fracture a patrimony read', async () => {
  const versions = [
    {
      patrimonySettings: {
        baseDate: new Date('2026-01-01'),
        openingCashBrl: '1000',
      },
      expense: [],
      entry: [],
      assetTransaction: [],
      piggyTransaction: [],
    },
    {
      patrimonySettings: {
        baseDate: new Date('2026-01-02'),
        openingCashBrl: '900',
      },
      expense: [{ id: 'internal-expense' }],
      entry: [{ id: 'internal-entry' }],
      assetTransaction: [{ id: 'asset-buy', expenseId: 'internal-expense' }],
      piggyTransaction: [{ id: 'piggy-withdraw', entryId: 'internal-entry' }],
    },
  ];
  let committedVersion = 0;
  let transactions = 0;
  const reads: string[] = [];

  const fakePrisma = {
    // Any query through the root Prisma client would escape the transaction.
    patrimonySettings: {
      findUnique: () => {
        throw new Error('unscoped settings');
      },
    },
    expense: {
      findMany: () => {
        throw new Error('unscoped expenses');
      },
    },
    entry: {
      findMany: () => {
        throw new Error('unscoped entries');
      },
    },
    assetTransaction: {
      findMany: () => {
        throw new Error('unscoped assets');
      },
    },
    piggyTransaction: {
      findMany: () => {
        throw new Error('unscoped piggy');
      },
    },
    $transaction: async (
      operation: (tx: object) => Promise<unknown>,
      options: { isolationLevel: string; maxWait: number; timeout: number },
    ) => {
      transactions += 1;
      assert.equal(options.isolationLevel, 'RepeatableRead');
      assert.ok(options.maxWait > 0 && options.maxWait <= 5_000);
      assert.ok(options.timeout >= 5_000 && options.timeout <= 20_000);

      // MVCC snapshot is pinned for the entire transaction. The writer commits
      // both sides atomically just after the expense query starts.
      const readVersion = committedVersion;
      const read = (model: keyof (typeof versions)[0]) => {
        reads.push(model);
        const value = versions[readVersion][model];
        if (model === 'expense') committedVersion = 1;
        return structuredClone(value);
      };
      return operation({
        patrimonySettings: { findUnique: () => read('patrimonySettings') },
        expense: { findMany: () => read('expense') },
        entry: { findMany: () => read('entry') },
        assetTransaction: { findMany: () => read('assetTransaction') },
        piggyTransaction: { findMany: () => read('piggyTransaction') },
      });
    },
  } as unknown as PrismaClient;

  const before = await readPatrimonySnapshot(fakePrisma, 'user-1');
  assert.equal(committedVersion, 1);
  assert.equal(before.settings.openingCashBrl.toString(), '1000');
  assert.equal(before.expenses.length, 0);
  assert.equal(before.assetTransactions.length, 0);
  assert.equal(before.piggyTransactions.length, 0);
  assert.equal(before.entries.length, 0);

  const after = await readPatrimonySnapshot(fakePrisma, 'user-1');
  assert.equal(after.settings.openingCashBrl.toString(), '900');
  assert.equal(after.expenses.length, 1);
  assert.equal(after.assetTransactions[0].expenseId, after.expenses[0].id);
  assert.equal(after.entries.length, 1);
  assert.equal(after.piggyTransactions[0].entryId, after.entries[0].id);
  assert.equal(transactions, 2);
  assert.equal(reads.filter((kind) => kind === 'patrimonySettings').length, 2);
  assert.equal(reads.filter((kind) => kind === 'expense').length, 2);
  assert.equal(reads.filter((kind) => kind === 'entry').length, 2);
  assert.equal(reads.filter((kind) => kind === 'assetTransaction').length, 2);
  assert.equal(reads.filter((kind) => kind === 'piggyTransaction').length, 2);
});

test('snapshot failures propagate and never fall back to unscoped reads', async () => {
  const failure = new Error('transaction unavailable');
  const fakePrisma = {
    $transaction: async () => {
      throw failure;
    },
  } as unknown as PrismaClient;
  await assert.rejects(
    readPatrimonySnapshot(fakePrisma, 'user-1'),
    (error) => error === failure,
  );
});
