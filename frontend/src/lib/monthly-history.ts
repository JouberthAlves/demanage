import { expenseCashAmount } from '@/lib/expense-splits';
import type {
  Income,
  MonthlySnapshot,
  RecurringExpense,
} from '@/types/finance';

function localMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function monthFromTimestamp(value: string, now: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date > now) return null;
  return localMonthKey(date);
}

function monthFromDateOnly(value: string | undefined, now: Date) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3]) ||
    date > new Date(now.getFullYear(), now.getMonth(), now.getDate())
  ) {
    return null;
  }
  return localMonthKey(date);
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

  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const firstMonth = addMonths(currentMonth, -monthCount + 1);
  const history: MonthlySnapshot[] = [];
  let cursor = firstMonth;

  while (cursor <= currentMonth) {
    const month = localMonthKey(cursor);
    const income = sumReceivedIncome(incomes, month, now);
    const expense = sumPaidExpenses(expenses, month, now);

    history.push({
      month,
      income,
      expense,
      hasActivity: income > 0 || expense > 0,
    });
    cursor = addMonths(cursor, 1);
  }

  return history;
}
