import { MONTH_LABELS, monthlyAmount } from '@/data/labels';
import { expenseCashAmount } from '@/lib/expense-splits';
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

function isSameMonth(date: Date, now: Date) {
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth()
  );
}

export function expenseMonthKey(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}`;
}

/** Monta YYYY-MM-DD do primeiro desconto/recebimento a partir de dia + mês (1-12). */
export function buildScheduleStartsAt(
  day: number,
  month: number,
  now = new Date(),
) {
  let year = now.getFullYear();
  if (month < now.getMonth() + 1) {
    year += 1;
  }

  const lastDay = new Date(year, month, 0).getDate();
  const safeDay = Math.min(Math.max(day, 1), lastDay);
  const monthStr = String(month).padStart(2, '0');
  const dayStr = String(safeDay).padStart(2, '0');
  return `${year}-${monthStr}-${dayStr}`;
}

/** @deprecated use buildScheduleStartsAt */
export const buildExpenseStartsAt = buildScheduleStartsAt;

export function formatStartsAtPreview(startsAt: string) {
  const date = parseLocalDate(startsAt);
  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTH_LABELS[date.getMonth() + 1] ?? '';
  const year = date.getFullYear();
  return `${day} de ${month} de ${year}`;
}

export function isExpenseScheduledThisMonth(
  expense: RecurringExpense,
  now = new Date(),
) {
  if (expense.isInvoice || expense.frequency === 'unica') return false;

  const dueDay = expense.dueDay ?? 1;
  const debitDate = resolveDebitDate(
    now.getFullYear(),
    now.getMonth(),
    dueDay,
  );

  if (expense.startsAt) {
    const startsAt = parseLocalDate(expense.startsAt);
    if (debitDate < startOfLocalDay(startsAt)) return false;
  }

  if (expense.endsAt) {
    const endsAt = parseLocalDate(expense.endsAt);
    if (debitDate > endsAt) return false;
  }

  return true;
}

export function isExpensePaidThisMonth(
  expense: RecurringExpense,
  now = new Date(),
) {
  return expense.paidForMonth === expenseMonthKey(now);
}

export function isExpenseAutoDebitedThisMonth(
  expense: RecurringExpense,
  now = new Date(),
) {
  if (!isExpenseScheduledThisMonth(expense, now)) return false;
  const debitDate = resolveDebitDate(
    now.getFullYear(),
    now.getMonth(),
    expense.dueDay ?? 1,
  );
  return startOfLocalDay(now) >= debitDate;
}

export function canPayExpenseEarly(
  expense: RecurringExpense,
  now = new Date(),
) {
  if (expense.frequency !== 'mensal' || expense.isInvoice) return false;
  if (!isExpenseScheduledThisMonth(expense, now)) return false;
  if (isExpensePaidThisMonth(expense, now)) return false;
  if (isExpenseAutoDebitedThisMonth(expense, now)) return false;
  return expenseCashAmount(expense) > 0;
}

/** Despesa já entrou no saldo do mês corrente. */
export function isExpenseDebitedThisMonth(
  expense: RecurringExpense,
  now = new Date(),
) {
  if (expense.isInvoice) return true;

  if (expense.frequency === 'unica') {
    if (!expense.registeredAt) return false;
    const registered = parseLocalDate(expense.registeredAt);
    return (
      isSameMonth(registered, now) &&
      startOfLocalDay(now) >= startOfLocalDay(registered)
    );
  }

  if (!isExpenseScheduledThisMonth(expense, now)) return false;
  if (isExpensePaidThisMonth(expense, now)) return true;
  return isExpenseAutoDebitedThisMonth(expense, now);
}

export function expenseContributionThisMonth(
  expense: RecurringExpense,
  now = new Date(),
) {
  if (!isExpenseDebitedThisMonth(expense, now)) return 0;
  const cash = expenseCashAmount(expense);
  if (cash <= 0) return 0;
  if (expense.frequency === 'unica') return cash;
  return monthlyAmount(cash, expense.frequency);
}
