import { expenseCashAmount } from '@/lib/expense-splits';
import type {
  Income,
  MonthlySnapshot,
  RecurringExpense,
} from '@/types/finance';

const FINANCIAL_TIMEZONE = 'America/Sao_Paulo';

function datePartsInSaoPaulo(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FINANCIAL_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function monthKeyInSaoPaulo(date: Date) {
  const parts = datePartsInSaoPaulo(date);
  return `${parts.year}-${parts.month}`;
}

function dayKeyInSaoPaulo(date: Date) {
  const parts = datePartsInSaoPaulo(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function monthFromTimestamp(value: string, now: Date) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date > now) return null;
  return monthKeyInSaoPaulo(date);
}

function monthFromDateOnly(value: string | undefined, now: Date) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const currentDay = dayKeyInSaoPaulo(now);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    value > currentDay
  ) {
    return null;
  }
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
  const currentMonth = monthKeyInSaoPaulo(now);
  const [year, month] = currentMonth.split('-').map(Number);
  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    const keyYear = date.getUTCFullYear();
    const keyMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
    const monthKey = `${keyYear}-${keyMonth}`;
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
