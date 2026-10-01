import assert from 'node:assert/strict';
import test from 'node:test';

import {
  expenseContributionThisMonth,
  expenseMonthKey,
  isExpenseInvoicePaidThisMonth,
} from '@/lib/expense-schedule';
import type { RecurringExpense } from '@/types/finance';

test('invoice settlement month follows the São Paulo calendar', () => {
  const now = new Date('2026-10-01T02:45:00.000Z');
  const invoice: RecurringExpense = {
    id: 'invoice-1',
    name: 'Fatura',
    amount: 80,
    category: 'outro',
    frequency: 'unica',
    isInvoice: true,
    payments: [
      {
        month: '2026-09',
        amount: 80,
        paidAt: '2026-10-01T02:30:00.000Z',
      },
    ],
  };

  assert.equal(expenseMonthKey(now), '2026-09');
  assert.equal(isExpenseInvoicePaidThisMonth(invoice, now), true);
  assert.equal(expenseContributionThisMonth(invoice, now), 80);
});
