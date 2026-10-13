import {
  addMonths,
  currentMonthKey,
  dayKeyOf,
  parseDayKey,
  todayKey,
} from '@/lib/dates';
import { expenseCashAmount } from '@/lib/expense-splits';
import type {
  Income,
  MonthlySnapshot,
  RecurringExpense,
} from '@/types/finance';

/** Month of a past timestamp; timestamps after today are ignored. */
function monthFromTimestamp(value: string, now: Date) {
  const day = dayKeyOf(value);
  if (!day || day > todayKey(now)) return null;
  return day.slice(0, 7);
}

/** Month of a past date-only value; future or invalid dates are ignored. */
function monthFromDateOnly(value: string | undefined, now: Date) {
  if (!value || !parseDayKey(value) || value > todayKey(now)) return null;
  return value.slice(0, 7);
}

function sumPaidExpenses(
  expenses: RecurringExpense[],
  month: string,
  now: Date,
) {
  return expenses.reduce((sum, expense) => {
    const payments = expense.payments ?? [];
    const paidThisMonth = payments.some(
      (payment) => monthFromTimestamp(payment.paidAt, now) === month,
    );
    const paidAmount = payments.reduce((paid, payment) => {
      if (monthFromTimestamp(payment.paidAt, now) !== month) return paid;
      const amount = Number(payment.amount);
      return paid + (Number.isFinite(amount) && amount > 0 ? amount : 0);
    }, 0);

    if (expense.isInvoice) return sum + paidAmount;

    if (expense.frequency === 'unica') {
      // The occurrence date is the evidence that this one-off expense exists;
      // createdAt alone can also mean an unpaid schedule was merely registered.
      if (!expense.occurredAt) return sum + paidAmount;
      const occurredOn = expense.registeredAt;
      const oneOffAmount =
        monthFromDateOnly(occurredOn, now) === month && !paidThisMonth
          ? expenseCashAmount(expense)
          : 0;
      return sum + paidAmount + oneOffAmount;
    }

    return sum + paidAmount;
  }, 0);
}

function sumReceivedIncome(incomes: Income[], month: string, now: Date) {
  return incomes.reduce((sum, income) => {
    const receipts = income.receipts ?? [];
    const receivedAmount = receipts.reduce((received, receipt) => {
      if (monthFromTimestamp(receipt.receivedAt, now) !== month) {
        return received;
      }
      const amount = Number(receipt.amount);
      return received + (Number.isFinite(amount) && amount > 0 ? amount : 0);
    }, 0);

    return sum + receivedAmount;
  }, 0);
}

export function buildMonthlyHistory(
  expenses: RecurringExpense[],
  incomes: Income[],
  now = new Date(),
  monthCount = 6,
): MonthlySnapshot[] {
  if (monthCount <= 0) return [];

  const history: MonthlySnapshot[] = [];
  const currentMonth = currentMonthKey(now);
  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const monthKey = addMonths(currentMonth, -offset);
    const income = sumReceivedIncome(incomes, monthKey, now);
    const expense = sumPaidExpenses(expenses, monthKey, now);

    history.push({
      month: monthKey,
      income,
      expense,
      hasActivity: income > 0 || expense > 0,
    });
  }

  return history;
}
