import { monthlyAmount } from '@/data/labels';
import { buildScheduleStartsAt } from '@/lib/expense-schedule';
import type { Income } from '@/types/finance';

export { buildScheduleStartsAt };

export function resolveReceiveDate(
  year: number,
  monthIndex: number,
  receiveDay: number,
) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const day = Math.min(Math.max(receiveDay, 1), lastDay);
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

export function incomeMonthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function isSalaryWaitingForConfirmation(
  income: Income,
  now = new Date(),
) {
  return (
    income.type === 'salario' &&
    income.frequency === 'mensal' &&
    income.receiptHoldForMonth === incomeMonthKey(now)
  );
}

export function isSalaryManuallyReceived(income: Income, now = new Date()) {
  return (
    income.type === 'salario' &&
    income.frequency === 'mensal' &&
    income.receivedForMonth === incomeMonthKey(now)
  );
}

/** Entrada entrou no saldo apenas pela agenda, sem override manual do salário. */
export function isIncomeAutoReceivedThisMonth(income: Income, now = new Date()) {
  if (income.frequency === 'unica') {
    if (!income.date) return false;
    const date = parseLocalDate(income.date);
    return (
      isSameMonth(date, now) && startOfLocalDay(now) >= startOfLocalDay(date)
    );
  }

  const receiveDay = income.receiveDay ?? 1;
  const receiveDate = resolveReceiveDate(
    now.getFullYear(),
    now.getMonth(),
    receiveDay,
  );

  if (startOfLocalDay(now) < receiveDate) return false;

  if (income.startsAt) {
    const startsAt = parseLocalDate(income.startsAt);
    if (receiveDate < startOfLocalDay(startsAt)) return false;
  }

  if (income.endsAt) {
    const endsAt = parseLocalDate(income.endsAt);
    if (receiveDate > endsAt) return false;
  }

  return true;
}

/** Entrada já entrou no saldo do mês corrente, incluindo confirmação manual do salário. */
export function isIncomeReceivedThisMonth(income: Income, now = new Date()) {
  if (isSalaryManuallyReceived(income, now)) return true;
  if (isSalaryWaitingForConfirmation(income, now)) return false;
  return isIncomeAutoReceivedThisMonth(income, now);
}

export function incomeContributionThisMonth(income: Income, now = new Date()) {
  if (!isIncomeReceivedThisMonth(income, now)) return 0;
  if (income.frequency === 'unica') return income.amount;
  return monthlyAmount(income.amount, income.frequency);
}
