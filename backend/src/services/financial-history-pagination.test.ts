import assert from 'node:assert/strict';
import test from 'node:test';

import { prisma } from '@/lib/prisma';
import { listFinancialHistoryPage } from '@/services/financial-history';

test('B13 bounds both ledger relations on every query and exposes separate stable cursors', async () => {
  const calls: Array<{ table: 'expense' | 'entry'; args: Record<string, unknown> }> = [];
  const expenseRows = ['e3', 'e2', 'e1'].map((id) => ({ id, createdAt: new Date('2026-10-01T00:00:00Z') }));
  const entryRows = ['i3', 'i2', 'i1'].map((id) => ({ id, createdAt: new Date('2026-10-01T00:00:00Z') }));
  const fake = {
    expense: { findMany: async (args: Record<string, unknown>) => {
      calls.push({ table: 'expense', args });
      return expenseRows;
    } },
    entry: { findMany: async (args: Record<string, unknown>) => {
      calls.push({ table: 'entry', args });
      return entryRows;
    } },
  } as unknown as Pick<typeof prisma, 'expense' | 'entry'>;
  const page = await listFinancialHistoryPage('account-1', { limit: 2 }, fake);
  assert.equal(page.expenses.length, 2);
  assert.equal(page.incomes.length, 2);
  assert.ok(page.nextExpenseCursor);
  assert.ok(page.nextIncomeCursor);
  assert.equal(calls.length, 2);
  for (const { table, args } of calls) {
    assert.equal(args.take, 3, 'LIMIT+1 to detect another page without unbounded reads');
    assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
    const where = args.where as { AND: Array<{ userId?: string; systemOrigin?: string; voidedAt?: null }> };
    assert.equal(where.AND[0]?.userId, 'account-1');
    assert.equal(where.AND[0]?.systemOrigin, 'manual');
    if (table === 'expense') assert.equal(where.AND[0]?.voidedAt, null);
    assert.ok(args.include);
  }
});

test('B13 rejects malformed cursor and invalid oversized page requests before hitting DB', async () => {
  const db = {
    expense: { findMany: () => { throw new Error('must not query'); } },
    entry: { findMany: () => { throw new Error('must not query'); } },
  } as unknown as Pick<typeof prisma, 'expense' | 'entry'>;
  for (const options of [
    { limit: 5000 },
    { limit: 0 },
    { limit: 5, expenseCursor: 'bad' },
    { limit: 5, incomeCursor: 'bad' },
  ]) {
    await assert.rejects(() => listFinancialHistoryPage('account-1', options, db), /invalid|limit|cursor/i);
  }
});
