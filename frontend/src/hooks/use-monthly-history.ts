import { useMemo } from 'react';

import { useIncomeList } from '@/hooks/use-entries';
import { useExpenseList } from '@/hooks/use-expenses';
import { useFinancialNow } from '@/hooks/use-financial-now';
import { useAssetTransactions } from '@/hooks/use-patrimony';
import { usePiggyCashMovements } from '@/hooks/use-piggy-banks';
import { currentMonthKey } from '@/lib/dates';
import { expenseContributionThisMonth } from '@/lib/expense-schedule';
import { incomeContributionThisMonth } from '@/lib/income-schedule';
import {
  assetCashContribution,
  buildMonthlyHistory,
  piggyCashContribution,
} from '@/lib/monthly-history';
import type { PiggyCashMovement } from '@/lib/piggy-api';
import type { AssetTransaction } from '@/types/patrimony';

const NO_PIGGY_MOVEMENTS: PiggyCashMovement[] = [];
const NO_ASSET_TRANSACTIONS: AssetTransaction[] = [];

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
  const expenses = useExpenseList();
  const incomes = useIncomeList();
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
  const expenses = useExpenseList();
  const piggyMovements = usePiggyCashMovements().data ?? NO_PIGGY_MOVEMENTS;
  const { transactions } = useAssetCashTransactions();
  const now = useFinancialNow();
  return useMemo(
    () =>
      expenses.reduce(
        (sum, expense) => sum + expenseContributionThisMonth(expense, now),
        0,
      ) +
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
  const incomes = useIncomeList();
  const piggyMovements = usePiggyCashMovements().data ?? NO_PIGGY_MOVEMENTS;
  const { transactions } = useAssetCashTransactions();
  const now = useFinancialNow();
  return useMemo(
    () =>
      incomes.reduce(
        (sum, income) => sum + incomeContributionThisMonth(income, now),
        0,
      ) +
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
    };
  }, [history, income, expenses]);
}
