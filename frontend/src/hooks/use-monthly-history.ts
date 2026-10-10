import { useMemo } from 'react';

import { useIncomeList } from '@/hooks/use-entries';
import { useExpenseList } from '@/hooks/use-expenses';
import { useFinancialNow } from '@/hooks/use-financial-now';
import { expenseContributionThisMonth } from '@/lib/expense-schedule';
import { incomeContributionThisMonth } from '@/lib/income-schedule';
import { buildMonthlyHistory } from '@/lib/monthly-history';

export function useMonthlyHistory() {
  const expenses = useExpenseList();
  const incomes = useIncomeList();
  const now = useFinancialNow();
  return useMemo(
    () => buildMonthlyHistory(expenses, incomes, now),
    [expenses, incomes, now],
  );
}

/** Expenses debited in the current month. */
export function useMonthlyExpenses() {
  const expenses = useExpenseList();
  const now = useFinancialNow();
  return useMemo(
    () =>
      expenses.reduce(
        (sum, expense) => sum + expenseContributionThisMonth(expense, now),
        0,
      ),
    [expenses, now],
  );
}

/** Incomes received in the current month. */
export function useMonthlyIncome() {
  const incomes = useIncomeList();
  const now = useFinancialNow();
  return useMemo(
    () =>
      incomes.reduce(
        (sum, income) => sum + incomeContributionThisMonth(income, now),
        0,
      ),
    [incomes, now],
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
