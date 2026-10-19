import assert from 'node:assert/strict';
import test from 'node:test';

import { incomeExpenseAreaData } from '@/components/dashboard/income-expense-area-data';
import type { MonthlySnapshot } from '@/types/finance';

const history: MonthlySnapshot[] = [
  { month: '2026-08', income: 250, expense: 80, hasActivity: true },
  { month: '2026-09', income: 0, expense: 0, hasActivity: false },
  { month: '2026-10', income: 1680, expense: 1581.41, hasActivity: true },
];

test('o gráfico mostra no mês atual os mesmos totais do saldo, sem alterar o histórico', () => {
  const data = incomeExpenseAreaData(history, 2614.87, 1581.41);
  assert.deepEqual(
    data.map(({ income, expense }) => ({ income, expense })),
    [
      { income: 250, expense: 80 },
      { income: 0, expense: 0 },
      { income: 2614.87, expense: 1581.41 },
    ],
  );
  assert.equal(history.at(-1)?.income, 1680);
});

test('o mês atual aparece mesmo sem recebimentos registrados no histórico', () => {
  const emptyHistory = history.map((month) => ({
    ...month,
    income: 0,
    expense: 0,
    hasActivity: false,
  }));
  const data = incomeExpenseAreaData(emptyHistory, 700, 125);
  assert.equal(data.at(-1)?.income, 700);
  assert.equal(data.at(-1)?.expense, 125);
  assert.equal(data.at(-2)?.income, 0);
});
