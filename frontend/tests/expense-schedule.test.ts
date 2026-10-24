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

test('F06: paid monthly PIX amount stays at the original settlement after editing the expense', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  const monthly: RecurringExpense = {
    id: 'monthly-paid',
    name: 'Aluguel alterado',
    amount: 900,
    category: 'outro',
    frequency: 'mensal',
    dueDay: 5,
    startsAt: '2026-01-05',
    paidForMonth: '2026-10',
    payments: [
      { month: '2026-10', amount: 100, paidAt: '2026-10-03T12:00:00.000Z' },
    ],
  };

  assert.equal(expenseContributionThisMonth(monthly, now), 100);
  // Alterações posteriores na divisão PIX/cartão não apagam caixa já liquidado.
  assert.equal(
    expenseContributionThisMonth(
      {
        ...monthly,
        splits: [{ kind: 'card', cardId: 'card-1', amount: 900, percent: 100 }],
      },
      now,
    ),
    100,
  );
});

test('F06: paid one-off keeps its recorded amount, while unregistered plans stay outside cash', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  const oneOff: RecurringExpense = {
    id: 'one-off-paid',
    name: 'Compra editada',
    amount: 900,
    category: 'outro',
    frequency: 'unica',
    occurredAt: '2026-10-02T12:00:00.000Z',
    registeredAt: '2026-10-02',
    payments: [
      { month: '2026-10', amount: 100, paidAt: '2026-10-02T12:00:00.000Z' },
    ],
  };

  assert.equal(expenseContributionThisMonth(oneOff, now), 100);
  assert.equal(
    expenseContributionThisMonth(
      { ...oneOff, payments: [], registeredAt: undefined },
      now,
    ),
    0,
  );
});

test('F06: early payment is attributed to its actual cash month without double debit', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  const monthly: RecurringExpense = {
    id: 'early-paid',
    name: 'Despesa antecipada',
    amount: 900,
    category: 'outro',
    frequency: 'mensal',
    dueDay: 5,
    startsAt: '2026-01-05',
    paidForMonth: '2026-11',
    payments: [
      { month: '2026-11', amount: 100, paidAt: '2026-10-10T12:00:00.000Z' },
    ],
  };

  assert.equal(expenseContributionThisMonth(monthly, now), 1000);
  assert.equal(
    expenseContributionThisMonth(monthly, new Date('2026-11-20T12:00:00.000Z')),
    0,
  );
});
