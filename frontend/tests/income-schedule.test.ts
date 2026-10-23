import assert from 'node:assert/strict';
import test from 'node:test';

import {
  incomeContributionThisMonth,
  incomeForecastContributionThisMonth,
  isIncomeReceivedThisMonth,
} from '@/lib/income-schedule';
import { buildMonthlyHistory } from '@/lib/monthly-history';
import type { Income } from '@/types/finance';

const now = new Date('2026-10-20T12:00:00.000Z');

function oneOff(overrides: Partial<Income> = {}): Income {
  return {
    id: 'one-off',
    name: 'Freelance',
    amount: 900,
    type: 'freelance',
    frequency: 'unica',
    date: '2026-10-05',
    ...overrides,
  };
}

test('F09: planned one-off income is forecast but not realized cash without a receipt', () => {
  const pending = oneOff();
  assert.equal(incomeForecastContributionThisMonth(pending, now), 900);
  assert.equal(incomeContributionThisMonth(pending, now), 0);
  assert.equal(isIncomeReceivedThisMonth(pending, now), false);
  assert.equal(buildMonthlyHistory([], [pending], now, 1)[0]?.income, 0);
});

test('F09: receipt snapshots win over edited amounts and may occur outside planned month', () => {
  const received = oneOff({
    amount: 900,
    date: '2026-09-15',
    receipts: [
      { month: '2026-10', amount: 100, receivedAt: '2026-10-10T12:00:00.000Z' },
    ],
  });

  assert.equal(incomeForecastContributionThisMonth(received, now), 0);
  assert.equal(incomeContributionThisMonth(received, now), 100);
  assert.equal(isIncomeReceivedThisMonth(received, now), true);
  assert.equal(buildMonthlyHistory([], [received], now, 2).at(-1)?.income, 100);
});

test('F09: pending future receipts cannot affect current realized balance', () => {
  const future = oneOff({
    date: '2026-10-25',
    receipts: [
      { month: '2026-10', amount: 100, receivedAt: '2026-10-25T12:00:00.000Z' },
    ],
  });
  assert.equal(incomeContributionThisMonth(future, now), 0);
  assert.equal(incomeForecastContributionThisMonth(future, now), 900);
});

test('F09: a receipt near UTC midnight uses the São Paulo financial month', () => {
  const endOfSeptember = new Date('2026-10-01T02:45:00.000Z');
  const received = oneOff({
    date: '2026-10-01',
    receipts: [
      { month: '2026-09', amount: 125, receivedAt: '2026-10-01T02:30:00.000Z' },
    ],
  });

  assert.equal(incomeContributionThisMonth(received, endOfSeptember), 125);
  assert.equal(
    incomeForecastContributionThisMonth(received, endOfSeptember),
    0,
  );
  assert.equal(
    buildMonthlyHistory([], [received], endOfSeptember, 1)[0]?.income,
    125,
  );
});

test('F09: monthly recurring income keeps calendar-based behavior', () => {
  const salary: Income = {
    id: 'salary',
    name: 'Salário',
    amount: 3000,
    type: 'salario',
    frequency: 'mensal',
    receiveDay: 5,
    startsAt: '2026-01-05',
  };
  assert.equal(incomeContributionThisMonth(salary, now), 3000);
  assert.equal(
    incomeForecastContributionThisMonth({ ...salary, receiveDay: 25 }, now),
    3000,
  );
  assert.equal(
    incomeContributionThisMonth(
      {
        ...salary,
        receiptHoldForMonth: '2026-10',
      },
      now,
    ),
    0,
  );
});
