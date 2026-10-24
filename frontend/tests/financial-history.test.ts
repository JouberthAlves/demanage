import type { AxiosResponse } from 'axios';
import assert from 'node:assert/strict';
import test from 'node:test';

import { api } from '@/lib/api';
import { listFinancialHistory } from '@/lib/financial-history-api';
import {
  buildMonthlyHistory,
  financialExpenseThisMonth,
  financialIncomeThisMonth,
} from '@/lib/monthly-history';
import type { Income, RecurringExpense } from '@/types/finance';

const now = new Date('2026-10-23T12:00:00Z');

test('archiving parents preserves September cash graph without reviving October schedules', () => {
  const archivedExpense = {
    id: 'expense',
    name: 'Old',
    amount: 950,
    category: 'outro',
    frequency: 'mensal',
    dueDay: 1,
    archivedAt: '2026-10-01T12:00:00Z',
    payments: [
      { month: '2026-09', amount: 42, paidAt: '2026-09-10T12:00:00Z' },
    ],
  } as RecurringExpense;
  const archivedIncome = {
    id: 'entry',
    name: 'Old',
    amount: 850,
    type: 'outro',
    frequency: 'mensal',
    receiveDay: 1,
    archivedAt: '2026-10-01T12:00:00Z',
    receipts: [
      { month: '2026-09', amount: 55, receivedAt: '2026-09-12T12:00:00Z' },
    ],
  } as Income;
  const months = buildMonthlyHistory(
    [archivedExpense],
    [archivedIncome],
    now,
    2,
  );
  assert.deepEqual(months, [
    { month: '2026-09', expense: 42, income: 55, hasActivity: true },
    { month: '2026-10', expense: 0, income: 0, hasActivity: false },
  ]);
  assert.equal(financialExpenseThisMonth([archivedExpense], now), 0);
  assert.equal(financialIncomeThisMonth([archivedIncome], now), 0);
});

test('archived paid expense and received income remain in current cash after archiving', () => {
  const expense = {
    id: 'old-expense',
    name: 'Archived',
    amount: 900,
    category: 'outro',
    frequency: 'mensal',
    dueDay: 5,
    archivedAt: '2026-10-20T12:00:00Z',
    payments: [
      { month: '2026-10', amount: 100, paidAt: '2026-10-06T12:00:00Z' },
    ],
  } as RecurringExpense;
  const income = {
    id: 'old-income',
    name: 'Archived',
    amount: 900,
    type: 'outro',
    frequency: 'mensal',
    receiveDay: 1,
    archivedAt: '2026-10-20T12:00:00Z',
    receipts: [
      { month: '2026-10', amount: 300, receivedAt: '2026-10-06T12:00:00Z' },
    ],
  } as Income;
  assert.equal(financialExpenseThisMonth([expense], now), 100);
  assert.equal(financialIncomeThisMonth([income], now), 300);
});

test('archived unpaid recurring templates do not continue scheduled charges/receipts', () => {
  const expense = {
    id: 'old-expense',
    name: 'Archived',
    amount: 900,
    category: 'outro',
    frequency: 'mensal',
    dueDay: 5,
    archivedAt: '2026-10-10T12:00:00Z',
    payments: [],
  } as RecurringExpense;
  const income = {
    id: 'old-income',
    name: 'Archived',
    amount: 900,
    type: 'outro',
    frequency: 'mensal',
    receiveDay: 1,
    archivedAt: '2026-10-10T12:00:00Z',
    receipts: [],
  } as Income;
  assert.equal(financialExpenseThisMonth([expense], now), 0);
  assert.equal(financialIncomeThisMonth([income], now), 0);
});

test('active templates still use existing schedule while archived contributions use payment evidence', () => {
  const expense = {
    id: 'active-expense',
    name: 'Active',
    amount: 50,
    category: 'outro',
    frequency: 'mensal',
    dueDay: 5,
  } as RecurringExpense;
  const income = {
    id: 'active-income',
    name: 'Active',
    amount: 70,
    type: 'outro',
    frequency: 'mensal',
    receiveDay: 1,
  } as Income;
  assert.equal(financialExpenseThisMonth([expense], now), 50);
  assert.equal(financialIncomeThisMonth([income], now), 70);
});

test('separate historical endpoint maps archived facts without changing normal CRUD responses', async () => {
  const originalAdapter = api.defaults.adapter;
  const paths: string[] = [];
  api.defaults.adapter = async (config): Promise<AxiosResponse> => {
    paths.push(config.url ?? '');
    assert.equal(config.method, 'get');
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        expenses: [
          {
            id: 'archived-expense',
            name: 'Past',
            amount: '42',
            category: 'outro',
            frequency: 'mensal',
            cardId: null,
            notes: null,
            archivedAt: '2026-10-01T12:00:00Z',
            payments: [
              {
                month: '2026-09',
                amount: '42',
                paidAt: '2026-09-10T12:00:00Z',
              },
            ],
          },
        ],
        incomes: [
          {
            id: 'archived-income',
            name: 'Past',
            amount: '55',
            type: 'outro',
            frequency: 'mensal',
            date: null,
            archivedAt: '2026-10-01T12:00:00Z',
            receipts: [
              {
                month: '2026-09',
                amount: '55',
                receivedAt: '2026-09-12T12:00:00Z',
              },
            ],
          },
        ],
      },
    };
  };
  try {
    const result = await listFinancialHistory();
    assert.deepEqual(paths, ['/financial-history']);
    assert.equal(result.expenses[0]?.archivedAt, '2026-10-01T12:00:00Z');
    assert.equal(result.expenses[0]?.payments?.[0]?.amount, 42);
    assert.equal(result.incomes[0]?.archivedAt, '2026-10-01T12:00:00Z');
    assert.equal(result.incomes[0]?.receipts?.[0]?.amount, 55);
  } finally {
    api.defaults.adapter = originalAdapter;
  }
});
