import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMonthlyHistory } from '@/lib/monthly-history';
import type { Income, RecurringExpense } from '@/types/finance';

function expense(overrides: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 'expense-1',
    name: 'Aluguel',
    amount: 1000,
    category: 'outro',
    frequency: 'mensal',
    dueDay: 5,
    createdAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

function income(overrides: Partial<Income> = {}): Income {
  return {
    id: 'income-1',
    name: 'Salário',
    amount: 3000,
    type: 'salario',
    frequency: 'mensal',
    receiveDay: 7,
    createdAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

test('histórico ignora itens vencidos sem pagamento ou recebimento registrado', () => {
  const now = new Date(2026, 8, 9, 12);
  const history = buildMonthlyHistory([expense()], [income()], now);

  assert.equal(history.length, 6);
  assert.equal(history.at(-2)?.hasActivity, false);
  assert.deepEqual(
    { income: history.at(-1)?.income, expense: history.at(-1)?.expense },
    { income: 0, expense: 0 },
  );
});

test('histórico soma somente valores e datas de pagamento e recebimento registrados', () => {
  const now = new Date('2026-09-03T18:00:00.000Z');
  const history = buildMonthlyHistory(
    [
      expense({
        amount: 1000,
        payments: [
          { month: '2026-09', amount: 250, paidAt: '2026-09-02T12:00:00.000Z' },
          { month: '2026-09', amount: 90, paidAt: '2026-09-05T12:00:00.000Z' },
        ],
      }),
    ],
    [
      income({
        receipts: [
          {
            month: '2026-09',
            amount: 1750,
            receivedAt: '2026-09-02T12:00:00.000Z',
          },
          {
            month: '2026-09',
            amount: 3000,
            receivedAt: '2026-09-05T12:00:00.000Z',
          },
        ],
      }),
    ],
    now,
  );

  assert.deepEqual(history.at(-1), {
    month: '2026-09',
    income: 1750,
    expense: 250,
    hasActivity: true,
  });
});

test('entradas avulsas só entram no mês com recebimento registrado', () => {
  const now = new Date(2026, 8, 3, 12);
  const history = buildMonthlyHistory(
    [
      expense({
        frequency: 'unica',
        amount: 75,
        createdAt: '2026-09-02T12:00:00.000Z',
        occurredAt: '2026-08-15T12:00:00.000Z',
        registeredAt: '2026-08-15',
      }),
      expense({
        id: 'unconfirmed-one-off',
        frequency: 'unica',
        amount: 40,
        registeredAt: '2026-08-16',
      }),
    ],
    [
      income({
        id: 'planned-one-off',
        frequency: 'unica',
        amount: 150,
        createdAt: '2026-09-02T12:00:00.000Z',
        date: '2026-08-20',
      }),
      income({
        id: 'received-one-off',
        frequency: 'unica',
        amount: 300,
        date: '2026-08-21',
        receipts: [
          {
            month: '2026-08',
            amount: 125,
            receivedAt: '2026-08-22T12:00:00.000Z',
          },
        ],
      }),
      income({
        id: 'future-one-off',
        frequency: 'unica',
        amount: 400,
        date: '2026-09-20',
      }),
    ],
    now,
  );

  assert.deepEqual(history.slice(-2), [
    {
      month: '2026-08',
      income: 125,
      expense: 75,
      hasActivity: true,
    },
    {
      month: '2026-09',
      income: 0,
      expense: 0,
      hasActivity: false,
    },
  ]);
});

test('eventos confirmados permanecem no histórico após mudar a recorrência para única', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');
  const history = buildMonthlyHistory(
    [
      expense({
        frequency: 'unica',
        occurredAt: '2026-09-03T12:00:00.000Z',
        registeredAt: '2026-09-03',
        amount: 400,
        payments: [
          {
            month: '2026-08',
            amount: 250,
            paidAt: '2026-08-07T12:00:00.000Z',
          },
        ],
      }),
    ],
    [
      income({
        frequency: 'unica',
        date: '2026-09-03',
        amount: 3000,
        receipts: [
          {
            month: '2026-08',
            amount: 2800,
            receivedAt: '2026-08-08T12:00:00.000Z',
          },
        ],
      }),
    ],
    now,
  );

  assert.deepEqual(history.slice(-2), [
    { month: '2026-08', income: 2800, expense: 250, hasActivity: true },
    { month: '2026-09', income: 0, expense: 400, hasActivity: true },
  ]);
});

test('faturas só entram com pagamento registrado e o histórico fica limitado a seis meses', () => {
  const now = new Date(2026, 8, 29, 12);
  const history = buildMonthlyHistory(
    [
      expense({
        createdAt: '2024-01-01T12:00:00.000Z',
        isInvoice: true,
        id: 'paid-invoice',
        payments: [
          { month: '2026-08', amount: 200, paidAt: '2026-08-10T12:00:00.000Z' },
        ],
      }),
      expense({
        id: 'unpaid-invoice',
        createdAt: '2024-01-01T12:00:00.000Z',
        isInvoice: true,
      }),
    ],
    [income({ createdAt: '2024-01-01T12:00:00.000Z' })],
    now,
  );

  assert.deepEqual(
    history.map((month) => month.month),
    ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
  );
  assert.deepEqual(history.at(-2), {
    month: '2026-08',
    income: 0,
    expense: 200,
    hasActivity: true,
  });
  assert.equal(history.at(-1)?.hasActivity, false);
});
