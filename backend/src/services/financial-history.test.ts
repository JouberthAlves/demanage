import assert from 'node:assert/strict';
import test from 'node:test';

import { prisma } from '@/lib/prisma';
import { listFinancialHistoryPage } from '@/services/financial-history';

test('historical financial queries keep archived manual parents and payment/receipt evidence, scoped to account', async () => {
  const calls: Array<{ domain: string; args: Record<string, unknown> }> = [];
  const archivedExpense = {
    id: 'e-old',
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
    archivedAt: new Date('2026-10-01'),
    payments: [{ amount: 42, paidAt: new Date('2026-09-10') }],
  };
  const archivedEntry = {
    id: 'i-old',
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
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

  const result = await listFinancialHistoryPage(
    'owner-1',
    { limit: 10 },
    db as unknown as Pick<typeof prisma, 'expense' | 'entry'>,
  );
  assert.deepEqual(result.expenses, [archivedExpense]);
  assert.deepEqual(result.incomes, [archivedEntry]);
  assert.equal(result.nextExpenseCursor, null);
  assert.equal(result.nextIncomeCursor, null);
  assert.equal(calls.length, 2);
  for (const { domain, args } of calls) {
    const clauses = (args.where as { AND: Array<Record<string, unknown>> }).AND;
    assert.deepEqual(clauses[0],
      domain === 'expense'
        ? { userId: 'owner-1', systemOrigin: 'manual', voidedAt: null }
        : { userId: 'owner-1', systemOrigin: 'manual' },
    );
    assert.equal(args.take, 11);
    assert.deepEqual(args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
    assert.ok(args.include && typeof args.include === 'object');
    assert.equal('archivedAt' in (args.where as object), false);
  }
  const [expense, entry] = calls.map(
    (call) => call.args.include as Record<string, unknown>,
  );
  assert.ok(expense?.payments && expense?.splits);
  assert.ok(entry?.receipts);
});
