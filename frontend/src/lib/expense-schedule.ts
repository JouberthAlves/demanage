import { monthlyAmount } from '@/data/labels';
import { currentMonthKey, monthKeyOf, todayKey } from '@/lib/dates';
import { expenseCashAmount } from '@/lib/expense-splits';
import {
  isSameMonth,
  isWithinSchedule,
  scheduledDayThisMonth,
} from '@/lib/schedule';
import type { RecurringExpense } from '@/types/finance';

export { buildScheduleStartsAt, formatStartsAtPreview } from '@/lib/schedule';

/** Month (São Paulo calendar) used for paidForMonth and payment records. */
export function expenseMonthKey(now: Date = new Date()) {
  return currentMonthKey(now);
}

export function isExpenseInvoicePaidThisMonth(
  expense: RecurringExpense,
  now: Date = new Date(),
) {
  const month = expenseMonthKey(now);
  return (
    expense.isInvoice === true &&
    (expense.payments ?? []).some(
      (payment) => monthKeyOf(payment.paidAt) === month,
    )
  );
}

function debitDayThisMonth(expense: RecurringExpense, now: Date) {
  return scheduledDayThisMonth(expense.dueDay ?? 1, now);
}

export function isExpenseScheduledThisMonth(
  expense: RecurringExpense,
  now: Date = new Date(),
) {
  if (expense.isInvoice || expense.frequency === 'unica') return false;
  return isWithinSchedule(debitDayThisMonth(expense, now), expense);
}

export function isExpensePaidThisMonth(
  expense: RecurringExpense,
  now: Date = new Date(),
) {
  return expense.paidForMonth === expenseMonthKey(now);
}

export function isExpenseAutoDebitedThisMonth(
  expense: RecurringExpense,
  now: Date = new Date(),
) {
  if (!isExpenseScheduledThisMonth(expense, now)) return false;
  return todayKey(now) >= debitDayThisMonth(expense, now);
}

export function canConfirmExpensePayment(
  expense: RecurringExpense,
  now: Date = new Date(),
) {
  if (expense.frequency !== 'mensal' || expense.isInvoice) return false;
  if (!isExpenseScheduledThisMonth(expense, now)) return false;
  if (isExpensePaidThisMonth(expense, now)) return false;
  return expenseCashAmount(expense) > 0;
}

export function canPayExpenseEarly(
  expense: RecurringExpense,
  now: Date = new Date(),
) {
  return (
    canConfirmExpensePayment(expense, now) &&
    !isExpenseAutoDebitedThisMonth(expense, now)
  );
}

/** Despesa já entrou no saldo do mês corrente. */
export function isExpenseDebitedThisMonth(
  expense: RecurringExpense,
  now: Date = new Date(),
) {
  if (expense.isInvoice) return isExpenseInvoicePaidThisMonth(expense, now);

  if (expense.frequency === 'unica') {
    const registered = expense.registeredAt?.slice(0, 10);
    if (!registered) return false;
    return isSameMonth(registered, now) && todayKey(now) >= registered;
  }

  if (!isExpenseScheduledThisMonth(expense, now)) return false;
  if (isExpensePaidThisMonth(expense, now)) return true;
  return isExpenseAutoDebitedThisMonth(expense, now);
}

export function expenseContributionThisMonth(
  expense: RecurringExpense,
  now: Date = new Date(),
) {
  if (!isExpenseDebitedThisMonth(expense, now)) return 0;
  if (expense.isInvoice) {
    const month = expenseMonthKey(now);
    return (expense.payments ?? []).reduce(
      (sum, payment) =>
        monthKeyOf(payment.paidAt) === month ? sum + payment.amount : sum,
      0,
    );
  }
  const cash = expenseCashAmount(expense);
  if (cash <= 0) return 0;
  if (expense.frequency === 'unica') return cash;
  return monthlyAmount(cash, expense.frequency);
}
