import { monthlyAmount } from '@/data/labels';
import type { RecurringExpense } from '@/types/finance';

export function resolveDebitDate(
  year: number,
  monthIndex: number,
  dueDay: number,
) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(Math.max(dueDay, 1), lastDay);
  return new Date(year, monthIndex, day);
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseLocalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return startOfLocalDay(new Date(value));
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Despesa recorrente já entrou no saldo do mês corrente. */
export function isExpenseDebitedThisMonth(
  expense: RecurringExpense,
  now = new Date(),
) {
  if (expense.isInvoice) return true;
  if (expense.frequency === 'unica') return false;

  const dueDay = expense.dueDay ?? 1;
  const debitDate = resolveDebitDate(
    now.getFullYear(),
    now.getMonth(),
    dueDay,
  );

  if (startOfLocalDay(now) < debitDate) return false;

  if (expense.endsAt) {
    const endsAt = parseLocalDate(expense.endsAt);
    if (debitDate > endsAt) return false;
  }

  return true;
}

export function expenseContributionThisMonth(
  expense: RecurringExpense,
  now = new Date(),
) {
  if (expense.cardId && !expense.isInvoice) return 0;
  if (!isExpenseDebitedThisMonth(expense, now)) return 0;
  return monthlyAmount(expense.amount, expense.frequency);
}
