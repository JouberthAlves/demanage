import { useMemo } from 'react';

import { useIncomeList } from '@/hooks/use-entries';
import { useExpenseList } from '@/hooks/use-expenses';
import { useFinancialNow } from '@/hooks/use-financial-now';
import { usePiggyCashMovements } from '@/hooks/use-piggy-banks';
import { currentMonthKey } from '@/lib/dates';
import { expenseContributionThisMonth } from '@/lib/expense-schedule';
import { incomeContributionThisMonth } from '@/lib/income-schedule';
import { buildMonthlyHistory, piggyCashContribution } from '@/lib/monthly-history';
import type { PiggyCashMovement } from '@/lib/piggy-api';

const NO_PIGGY_MOVEMENTS: PiggyCashMovement[] = [];

export function useMonthlyHistory() {
  const expenses = useExpenseList();
  const incomes = useIncomeList();
  const piggyMovements = usePiggyCashMovements().data ?? NO_PIGGY_MOVEMENTS;
  const now = useFinancialNow();
  return useMemo(
    () => buildMonthlyHistory(expenses, incomes, now, 6, piggyMovements),
    [expenses, incomes, now, piggyMovements],
  );
}

/** Expenses debited in the current month. */
export function useMonthlyExpenses() {
  const expenses = useExpenseList();
  const piggyMovements = usePiggyCashMovements().data ?? NO_PIGGY_MOVEMENTS;
  const now = useFinancialNow();
  return useMemo(
    () =>
      expenses.reduce(
        (sum, expense) => sum + expenseContributionThisMonth(expense, now),
        0,
      ) + piggyCashContribution(piggyMovements, currentMonthKey(now), 'deposit', now),
    [expenses, now, piggyMovements],
  );
}

/** Incomes received in the current month. */
export function useMonthlyIncome() {
  const incomes = useIncomeList();
  const piggyMovements = usePiggyCashMovements().data ?? NO_PIGGY_MOVEMENTS;
  const now = useFinancialNow();
  return useMemo(
    () =>
      incomes.reduce(
        (sum, income) => sum + incomeContributionThisMonth(income, now),
        0,
      ) + piggyCashContribution(piggyMovements, currentMonthKey(now), 'withdraw', now),
    [incomes, now, piggyMovements],
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
