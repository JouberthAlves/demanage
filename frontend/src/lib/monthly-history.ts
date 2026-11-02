import {
  addMonths,
  currentMonthKey,
  dayKeyOf,
  parseDayKey,
  todayKey,
} from '@/lib/dates';
import { expenseContributionThisMonth } from '@/lib/expense-schedule';
import { expenseCashAmount } from '@/lib/expense-splits';
import {
  incomeContributionThisMonth,
  incomeReceiptsInMonth,
} from '@/lib/income-schedule';
import type { PiggyCashMovement } from '@/lib/piggy-api';
import type {
  Income,
  MonthlySnapshot,
  RecurringExpense,
} from '@/types/finance';
import type { AssetTransaction } from '@/types/patrimony';

/** Month of a past timestamp; timestamps after today are ignored. */
function monthFromTimestamp(value: string, now: Date) {
  const day = dayKeyOf(value);
  if (!day || day > todayKey(now)) return null;
  return day.slice(0, 7);
}

/** Month of a civil date or API ISO timestamp; future/invalid dates are ignored. */
function monthFromDateOnly(value: string | undefined, now: Date) {
  if (!value || !parseDayKey(value)) return null;
  // API asset transactions are serialized as full UTC ISO timestamps, while
  // planned expenses and cofrinho movements contain plain YYYY-MM-DD keys.
  // Do not parse date-only keys as UTC midnight (which shifts them to yesterday
  // in São Paulo); do not compare timestamps lexically with YYYY-MM-DD either.
  const day = value.length === 10 ? value : dayKeyOf(value);
  if (!day || day > todayKey(now)) return null;
  return day.slice(0, 7);
}

/** Cash-only cofrinho movements: opt-out deposits and corrections are excluded by the API. */
export function piggyCashContribution(
  movements: PiggyCashMovement[],
  month: string,
  type: PiggyCashMovement['type'],
  now: Date,
) {
  return movements.reduce(
    (sum, movement) =>
      movement.type === type && monthFromDateOnly(movement.date, now) === month
        ? sum + movement.amount
        : sum,
    0,
  );
}

/** Asset trades create an internal ledger expense/entry hidden from normal CRUD.
 * Count the source transaction once, only if its cash ledger movement exists.
 * Manual position adjustments have no cash impact.
 */
export function assetCashContribution(
  transactions: AssetTransaction[],
  month: string,
  type: 'BUY' | 'SELL',
  now: Date,
) {
  return transactions.reduce((sum, transaction) => {
    if (
      transaction.type !== type ||
      monthFromDateOnly(transaction.date, now) !== month ||
      (type === 'BUY' ? !transaction.expenseId : !transaction.entryId)
    ) {
      return sum;
    }
    const cash = Number(transaction.cashAmountBrl);
    return sum + (Number.isFinite(cash) && cash > 0 ? cash : 0);
  }, 0);
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
  return incomes.reduce(
    (sum, income) => sum + incomeReceiptsInMonth(income, month, now),
    0,
  );
}

/** Live templates use schedule rules; archived ones contribute recorded cash only. */
export function financialExpenseThisMonth(
  expenses: RecurringExpense[],
  now: Date,
) {
  const month = currentMonthKey(now);
  return expenses.reduce(
    (sum, expense) =>
      sum +
      (expense.archivedAt
        ? sumPaidExpenses([expense], month, now)
        : expenseContributionThisMonth(expense, now)),
    0,
  );
}

export function financialIncomeThisMonth(incomes: Income[], now: Date) {
  const month = currentMonthKey(now);
  return incomes.reduce(
    (sum, income) =>
      sum +
      (income.archivedAt
        ? incomeReceiptsInMonth(income, month, now)
        : incomeContributionThisMonth(income, now)),
    0,
  );
}

/**
 * Cash recorded before the current month is the opening balance of this month.
 * Unlike the six-month chart, this must include the entire recorded history:
 * rolling the calendar over must never reset the user's accumulated cash.
 *
 * Past recurring schedules without an actual receipt/payment are not cash
 * evidence. The current month's scheduled amounts are added separately by
 * financialIncomeThisMonth/financialExpenseThisMonth.
 */
export function cashCarryoverBeforeCurrentMonth(
  expenses: RecurringExpense[],
  incomes: Income[],
  now: Date,
  piggyMovements: PiggyCashMovement[] = [],
  assetTransactions: AssetTransaction[] = [],
) {
  const currentMonth = currentMonthKey(now);
  const isPastMonth = (month: string | null) =>
    month !== null && month < currentMonth;
  const cashAmount = (value: number | string) => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  };

  const received = incomes.reduce(
    (total, income) =>
      total +
      (income.receipts ?? []).reduce(
        (sum, receipt) =>
          sum +
          (isPastMonth(monthFromTimestamp(receipt.receivedAt, now))
            ? cashAmount(receipt.amount)
            : 0),
        0,
      ),
    0,
  );

  const spent = expenses.reduce((total, expense) => {
    const payments = (expense.payments ?? []).filter((payment) =>
      monthFromTimestamp(payment.paidAt, now),
    );
    const paidBefore = payments.reduce(
      (sum, payment) =>
        sum +
        (isPastMonth(monthFromTimestamp(payment.paidAt, now))
          ? cashAmount(payment.amount)
          : 0),
      0,
    );

    // Match the historical chart: an occurred one-off adds cash unless a
    // payment already records that same calendar month. Older payments of a
    // former recurring template may be different, legitimate cash events.
    const registeredMonth = monthFromDateOnly(expense.registeredAt, now);
    const unreceiptedOneOff =
      !expense.isInvoice &&
      expense.frequency === 'unica' &&
      expense.occurredAt &&
      isPastMonth(registeredMonth) &&
      !payments.some(
        (payment) => monthFromTimestamp(payment.paidAt, now) === registeredMonth,
      )
        ? cashAmount(expenseCashAmount(expense))
        : 0;
    return total + paidBefore + unreceiptedOneOff;
  }, 0);

  const piggyNet = piggyMovements.reduce((total, movement) => {
    if (!isPastMonth(monthFromDateOnly(movement.date, now))) return total;
    const amount = cashAmount(movement.amount);
    return total + (movement.type === 'withdraw' ? amount : -amount);
  }, 0);

  const assetNet = assetTransactions.reduce((total, transaction) => {
    if (!isPastMonth(monthFromDateOnly(transaction.date, now))) return total;
    if (transaction.type === 'BUY' && transaction.expenseId) {
      return total - cashAmount(transaction.cashAmountBrl);
    }
    if (transaction.type === 'SELL' && transaction.entryId) {
      return total + cashAmount(transaction.cashAmountBrl);
    }
    return total;
  }, 0);

  return received - spent + piggyNet + assetNet;
}

export function buildMonthlyHistory(
  expenses: RecurringExpense[],
  incomes: Income[],
  now = new Date(),
  monthCount = 6,
  piggyMovements: PiggyCashMovement[] = [],
  assetTransactions: AssetTransaction[] = [],
): MonthlySnapshot[] {
  if (monthCount <= 0) return [];

  const history: MonthlySnapshot[] = [];
  const currentMonth = currentMonthKey(now);
  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const monthKey = addMonths(currentMonth, -offset);
    const income =
      sumReceivedIncome(incomes, monthKey, now) +
      piggyCashContribution(piggyMovements, monthKey, 'withdraw', now) +
      assetCashContribution(assetTransactions, monthKey, 'SELL', now);
    const expense =
      sumPaidExpenses(expenses, monthKey, now) +
      piggyCashContribution(piggyMovements, monthKey, 'deposit', now) +
      assetCashContribution(assetTransactions, monthKey, 'BUY', now);

    history.push({
      month: monthKey,
      income,
      expense,
      hasActivity: income > 0 || expense > 0,
    });
  }

  return history;
}
