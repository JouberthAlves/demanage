import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import assert from 'node:assert/strict';
import test from 'node:test';

import { CategoryDonutChart } from '@/components/dashboard/category-donut-chart';
import {
  useMonthlyExpenses,
  useMonthlyIncome,
} from '@/hooks/use-monthly-history';
import { addDays, addMonths, instantForDayKey } from '@/lib/dates';
import { formatCurrencyCompact } from '@/lib/format';
import { queryKeys } from '@/lib/query-keys';
import { useCalendarStore } from '@/stores/calendar-store';
import type { RecurringExpense } from '@/types/finance';
import type { AssetTransaction } from '@/types/patrimony';

function trade(overrides: Partial<AssetTransaction>): AssetTransaction {
  return {
    id: 'btc-buy',
    asset: 'BTC',
    type: 'BUY',
    quantity: '0.01',
    cashAmountBrl: '1200',
    feeAmountBrl: '0',
    feePercent: null,
    costBasisKnown: true,
    date: useCalendarStore.getInitialState().dayKey,
    note: null,
    expenseId: 'internal-expense',
    entryId: null,
    createdAt: '2026-10-18T12:00:00.000Z',
    ...overrides,
  };
}

test('donut cash categories reconcile BTC/USD purchases with monthly expense KPI, excluding sales and adjustments', () => {
  const originalDayKey = useCalendarStore.getState().dayKey;
  // React SSR reads Zustand's initial snapshot rather than setState updates.
  // Use that financial day in the test data so the test survives month rollover.
  const financialDay = useCalendarStore.getInitialState().dayKey;
  const previousMonthDay = `${addMonths(financialDay.slice(0, 7), -1)}-01`;
  useCalendarStore.setState({ dayKey: financialDay });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  });

  const manualInvestment: RecurringExpense = {
    id: 'manual-investment',
    name: 'Investimento avulso',
    amount: 75,
    category: 'investimento',
    frequency: 'unica',
    occurredAt: instantForDayKey(financialDay).toISOString(),
    registeredAt: financialDay,
    createdAt: instantForDayKey(financialDay).toISOString(),
  };
  client.setQueryData(queryKeys.financialHistory, {
    expenses: [manualInvestment],
    incomes: [],
  });
  client.setQueryData(queryKeys.piggyBanks.cashMovements, [
    { type: 'deposit', date: financialDay, amount: 200 },
  ]);
  client.setQueryData(queryKeys.assets.transactions('BTC'), [
    trade({}),
    trade({
      id: 'sell',
      type: 'SELL',
      expenseId: null,
      entryId: 'sale',
      cashAmountBrl: '300',
    }),
    trade({
      id: 'adjustment',
      type: 'MANUAL_ADJUSTMENT',
      expenseId: null,
      cashAmountBrl: '7777',
    }),
    trade({ id: 'unlinked-buy', expenseId: null, cashAmountBrl: '9000' }),
    trade({ id: 'future-buy', date: addDays(financialDay, 5), cashAmountBrl: '5000' }),
    trade({ id: 'prior-buy', date: previousMonthDay, cashAmountBrl: '6000' }),
  ]);
  client.setQueryData(queryKeys.assets.transactions('USD'), [
    trade({ id: 'usd-buy', asset: 'USD', cashAmountBrl: '400' }),
  ]);

  function CashProbe() {
    const expenses = useMonthlyExpenses();
    const income = useMonthlyIncome();
    return createElement(
      'output',
      { 'data-income': income, 'data-expenses': expenses },
      createElement(CategoryDonutChart),
    );
  }

  try {
    const html = renderToString(
      createElement(QueryClientProvider, { client }, createElement(CashProbe)),
    );
    assert.match(html, /data-expenses="1875"/);
    assert.match(html, /data-income="300"/);
    assert.match(html, /Investimento/);
    const investmentRow = html
      .split('Investimento</span>')[1]
      ?.split('Cofrinho</span>')[0];
    assert.ok(investmentRow?.includes(formatCurrencyCompact(1675)));
    assert.match(html, /Cofrinho/);
    assert.ok(html.includes(`title="${formatCurrencyCompact(1875)}"`));
  } finally {
    client.clear();
    useCalendarStore.setState({ dayKey: originalDayKey });
  }
});
