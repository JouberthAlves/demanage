import assert from 'node:assert/strict';
import test from 'node:test';

import { prisma } from '@/lib/prisma';
import { listFinancialHistory } from '@/services/financial-history';

test('historical financial queries keep archived manual parents and payment/receipt evidence, scoped to account', async () => {
  const calls: Array<{ domain: string; args: Record<string, unknown> }> = [];
  const archivedExpense = {
    id: 'e-old',
    archivedAt: new Date('2026-10-01'),
    payments: [{ amount: 42, paidAt: new Date('2026-09-10') }],
  };
  const archivedEntry = {
    id: 'i-old',
    archivedAt: new Date('2026-10-01'),
    receipts: [{ amount: 55, receivedAt: new Date('2026-09-12') }],
  };
  const db = {
    expense: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ domain: 'expense', args });
        return [archivedExpense];
      },
    },
    entry: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push({ domain: 'entry', args });
        return [archivedEntry];
      },
    },
  };

  const result = await listFinancialHistory(
    'owner-1',
    db as unknown as Pick<typeof prisma, 'expense' | 'entry'>,
  );
  assert.deepEqual(result, {
    expenses: [archivedExpense],
    incomes: [archivedEntry],
  });
  assert.equal(calls.length, 2);
  for (const { args } of calls) {
    assert.deepEqual(args.where, { userId: 'owner-1', systemOrigin: 'manual' });
    assert.ok(args.include && typeof args.include === 'object');
    assert.equal('archivedAt' in (args.where as object), false);
  }
  const [expense, entry] = calls.map(
    (call) => call.args.include as Record<string, unknown>,
  );
  assert.ok(expense?.payments && expense?.splits);
  assert.ok(entry?.receipts);
});
