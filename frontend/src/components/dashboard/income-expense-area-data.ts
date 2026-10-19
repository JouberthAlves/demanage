import { formatMonthLabel } from '@/lib/format';
import type { MonthlySnapshot } from '@/types/finance';

export function incomeExpenseAreaData(
  history: MonthlySnapshot[],
  currentIncome: number,
  currentExpense: number,
) {
  return history.map((item, index) => ({
    label: formatMonthLabel(item.month),
    income: index === history.length - 1 ? currentIncome : item.income,
    expense: index === history.length - 1 ? currentExpense : item.expense,
  }));
}
