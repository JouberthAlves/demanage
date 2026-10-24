import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useFinancialNow } from '@/hooks/use-financial-now';
import { useAssetTransactions } from '@/hooks/use-patrimony';
import { usePiggyCashMovements } from '@/hooks/use-piggy-banks';
import { currentMonthKey } from '@/lib/dates';
import { listFinancialHistory } from '@/lib/financial-history-api';
import {
  assetCashContribution,
  buildMonthlyHistory,
  financialExpenseThisMonth,
  financialIncomeThisMonth,
  piggyCashContribution,
} from '@/lib/monthly-history';
import type { PiggyCashMovement } from '@/lib/piggy-api';
import { queryKeys } from '@/lib/query-keys';
import type { Income, RecurringExpense } from '@/types/finance';
import type { AssetTransaction } from '@/types/patrimony';

const NO_PIGGY_MOVEMENTS: PiggyCashMovement[] = [];
const NO_ASSET_TRANSACTIONS: AssetTransaction[] = [];
const NO_EXPENSES: RecurringExpense[] = [];
const NO_INCOMES: Income[] = [];

/** Separate read-only history source includes archived manual cash events. */
export function useFinancialHistory() {
  return useQuery({
    queryKey: queryKeys.financialHistory,
    queryFn: listFinancialHistory,
    staleTime: 60_000,
  });
}

/** Shared React Query keys deduplicate the two asset queries across dashboard cards. */
export function useAssetCashTransactions() {
  const btc = useAssetTransactions('BTC');
  const usd = useAssetTransactions('USD');
  const transactions = useMemo(
    () =>
      (btc.data ?? NO_ASSET_TRANSACTIONS).concat(
        usd.data ?? NO_ASSET_TRANSACTIONS,
      ),
    [btc.data, usd.data],
  );
  return {
    transactions,
    isError: btc.isError || usd.isError,
    isPending: btc.isPending || usd.isPending,
    refetch: () => Promise.all([btc.refetch(), usd.refetch()]),
  };
}

export function useMonthlyHistory() {
  const { data } = useFinancialHistory();
  const expenses = data?.expenses ?? NO_EXPENSES;
  const incomes = data?.incomes ?? NO_INCOMES;
  const piggyMovements = usePiggyCashMovements().data ?? NO_PIGGY_MOVEMENTS;
  const { transactions } = useAssetCashTransactions();
  const now = useFinancialNow();
  return useMemo(
    () =>
      buildMonthlyHistory(
        expenses,
        incomes,
        now,
        6,
        piggyMovements,
        transactions,
      ),
    [expenses, incomes, now, piggyMovements, transactions],
  );
}

/** Expenses debited in the current month. */
export function useMonthlyExpenses() {
  const expenses = useFinancialHistory().data?.expenses ?? NO_EXPENSES;
  const piggyMovements = usePiggyCashMovements().data ?? NO_PIGGY_MOVEMENTS;
  const { transactions } = useAssetCashTransactions();
  const now = useFinancialNow();
  return useMemo(
    () =>
      financialExpenseThisMonth(expenses, now) +
      piggyCashContribution(
        piggyMovements,
        currentMonthKey(now),
        'deposit',
        now,
      ) +
      assetCashContribution(transactions, currentMonthKey(now), 'BUY', now),
    [expenses, now, piggyMovements, transactions],
  );
}

/** Incomes received in the current month. */
export function useMonthlyIncome() {
  const incomes = useFinancialHistory().data?.incomes ?? NO_INCOMES;
  const piggyMovements = usePiggyCashMovements().data ?? NO_PIGGY_MOVEMENTS;
  const { transactions } = useAssetCashTransactions();
  const now = useFinancialNow();
  return useMemo(
    () =>
      financialIncomeThisMonth(incomes, now) +
      piggyCashContribution(
        piggyMovements,
        currentMonthKey(now),
        'withdraw',
        now,
      ) +
      assetCashContribution(transactions, currentMonthKey(now), 'SELL', now),
    [incomes, now, piggyMovements, transactions],
  );
}

/** Dashboard figures, all derived from the same query data and clock. */
export function useFinanceSummary() {
  const historicalQuery = useFinancialHistory();
  const history = useMonthlyHistory();
  const income = useMonthlyIncome();
  const expenses = useMonthlyExpenses();

  return useMemo(() => {
    const active = history.filter((item) => item.hasActivity);
    const averageExpense =
      active.length === 0
        ? expenses
        : active.reduce((sum, item) => sum + item.expense, 0) / active.length;
    return {
      history,
      income,
      expenses,
      averageExpense,
      recurringShare: income > 0 ? expenses / income : 0,
      historyQuery: historicalQuery,
    };
  }, [history, income, expenses, historicalQuery]);
}
