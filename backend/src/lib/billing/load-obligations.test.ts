import assert from 'node:assert/strict';
import test from 'node:test';

import type { Prisma } from '@/generated/prisma/client';
import { chargesTotalForClosing } from '@/lib/billing/charges';

import { loadBillableExpensesForCards } from './obligation-versions';

const at = (day: string) => new Date(`${day}T12:00:00.000Z`);

test('final card settlement loads historical obligations across every account expense', async () => {
  const queries: unknown[] = [];
  const transaction = {
    expense: {
      findMany: async (query: unknown) => {
        queries.push(query);
        return [{
          id: 'expense-1', userId: 'owner-1', amount: '200', cardId: null,
          isInvoice: false, frequency: 'mensal', startsAt: at('2026-08-01'),
          endsAt: null, dueDay: 1, occurredAt: null, archivedAt: null,
          createdAt: at('2026-08-01'),
          splits: [
            { kind: 'card', cardId: 'card-b', amount: '150' },
            { kind: 'pix', cardId: null, amount: '50' },
          ],
          obligationVersions: [
            { id: 'version-a', expenseId: 'expense-1', sequence: 1,
              effectiveMonth: '2026-08', amount: '100', cardId: null,
              splits: [{ kind: 'card', cardId: 'card-a', amount: '60', percent: '60' },
                { kind: 'pix', cardId: null, amount: '40', percent: '40' }] },
            { id: 'version-b', expenseId: 'expense-1', sequence: 2,
              effectiveMonth: '2026-10', amount: '200', cardId: null,
              splits: [{ kind: 'card', cardId: 'card-b', amount: '150', percent: '75' },
                { kind: 'pix', cardId: null, amount: '50', percent: '25' }] },
          ],
        }];
      },
    },
  } as unknown as Prisma.TransactionClient;

  const expenses = await loadBillableExpensesForCards(transaction, 'owner-1');
  assert.deepEqual(queries, [{
    where: { userId: 'owner-1', isInvoice: false },
    include: { splits: true, obligationVersions: { orderBy: { sequence: 'asc' } } },
  }]);
  assert.equal(chargesTotalForClosing(expenses, 'card-a', at('2026-10-31'), at('2026-08-01'), true), 120);
  assert.equal(chargesTotalForClosing(expenses, 'card-b', at('2026-10-31'), at('2026-08-01'), true), 150);
});
