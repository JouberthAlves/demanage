import { monthlyAmount } from '@/data/labels';
import { currentMonthKey, dayKeyOf, todayKey } from '@/lib/dates';
import {
  isSameMonth,
  isWithinSchedule,
  scheduledDayThisMonth,
} from '@/lib/schedule';
import type { Income } from '@/types/finance';

export { buildScheduleStartsAt } from '@/lib/schedule';

/** Month (São Paulo calendar) used for receivedForMonth / receiptHoldForMonth. */
export function incomeMonthKey(now: Date = new Date()) {
  return currentMonthKey(now);
}

export function isSalaryWaitingForConfirmation(
  income: Income,
  now: Date = new Date(),
) {
  return (
    income.type === 'salario' &&
    income.frequency === 'mensal' &&
    income.receiptHoldForMonth === incomeMonthKey(now)
  );
}

export function isSalaryManuallyReceived(
  income: Income,
  now: Date = new Date(),
) {
  return (
    income.type === 'salario' &&
    income.frequency === 'mensal' &&
    income.receivedForMonth === incomeMonthKey(now)
  );
}

/** Entrada entrou no saldo apenas pela agenda, sem override manual do salário. */
export function isIncomeAutoReceivedThisMonth(
  income: Income,
  now: Date = new Date(),
) {
  const today = todayKey(now);
  if (income.frequency === 'unica') {
    const date = income.date?.slice(0, 10);
    if (!date) return false;
    return isSameMonth(date, now) && today >= date;
  }

  const receiveDay = scheduledDayThisMonth(income.receiveDay ?? 1, now);
  if (today < receiveDay) return false;
  return isWithinSchedule(receiveDay, income);
}

/** Entrada já entrou no saldo do mês corrente, incluindo confirmação manual do salário. */
export function isIncomeReceivedThisMonth(
  income: Income,
  now: Date = new Date(),
) {
  if (income.frequency === 'unica') {
    return incomeReceiptsInMonth(income, incomeMonthKey(now), now) > 0;
  }
  if (isSalaryManuallyReceived(income, now)) return true;
  if (isSalaryWaitingForConfirmation(income, now)) return false;
  return isIncomeAutoReceivedThisMonth(income, now);
}

/** Confirmed receipts use the real event date and the amount saved at confirmation. */
export function incomeReceiptsInMonth(
  income: Income,
  month: string,
  now: Date,
) {
  const today = todayKey(now);
  return (income.receipts ?? []).reduce((sum, receipt) => {
    const receivedDay = dayKeyOf(receipt.receivedAt);
    const amount = Number(receipt.amount);
    if (
      !receivedDay ||
      receivedDay > today ||
      receivedDay.slice(0, 7) !== month
    ) {
      return sum;
    }
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);
}

/** Forecast covers the full scheduled month, even before its day or receipt. */
export function incomeForecastContributionThisMonth(
  income: Income,
  now: Date = new Date(),
) {
  if (income.frequency === 'unica') {
    const date = income.date?.slice(0, 10);
    return date && isSameMonth(date, now) ? income.amount : 0;
  }
  const receiveDay = scheduledDayThisMonth(income.receiveDay ?? 1, now);
  if (!isWithinSchedule(receiveDay, income)) return 0;
  return monthlyAmount(income.amount, income.frequency);
}

/** Current balance: one-off incomes require receipts; recurring incomes keep their schedule rules. */
export function incomeContributionThisMonth(
  income: Income,
  now: Date = new Date(),
) {
  if (income.frequency === 'unica') {
    return incomeReceiptsInMonth(income, incomeMonthKey(now), now);
  }
  if (!isIncomeReceivedThisMonth(income, now)) return 0;
  return monthlyAmount(income.amount, income.frequency);
}
