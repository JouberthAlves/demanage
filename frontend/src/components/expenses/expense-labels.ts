import { formatDayKeyBr, formatScheduleDay } from '@/lib/schedule-labels';
import type { RecurringExpense } from '@/types/finance';

/** When the expense is debited: its date (one-off) or "Dia 05 · Outubro". */
export function expenseDiscountLabel(expense: RecurringExpense) {
  if (expense.frequency === 'unica') {
    return formatDayKeyBr(expense.registeredAt) ?? 'Hoje';
  }
  return formatScheduleDay(expense.dueDay, expense.startsAt);
}
