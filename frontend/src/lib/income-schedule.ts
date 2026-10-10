import { monthlyAmount } from '@/data/labels';
import { currentMonthKey, todayKey } from '@/lib/dates';
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
  if (isSalaryManuallyReceived(income, now)) return true;
  if (isSalaryWaitingForConfirmation(income, now)) return false;
  return isIncomeAutoReceivedThisMonth(income, now);
}

export function incomeContributionThisMonth(
  income: Income,
  now: Date = new Date(),
) {
  if (!isIncomeReceivedThisMonth(income, now)) return 0;
  if (income.frequency === 'unica') return income.amount;
  return monthlyAmount(income.amount, income.frequency);
}
