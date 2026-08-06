import { monthlyAmount } from '@/data/labels';
import type { Income } from '@/types/finance';

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

/** Entrada recorrente já entrou no saldo do mês corrente. */
export function isIncomeReceivedThisMonth(income: Income, now = new Date()) {
  if (income.frequency === 'unica') return false;

  const receiveDay = income.receiveDay ?? 1;
  const receiveDate = resolveReceiveDate(
    now.getFullYear(),
    now.getMonth(),
    receiveDay,
  );

  if (startOfLocalDay(now) < receiveDate) return false;

  if (income.endsAt) {
    const endsAt = parseLocalDate(income.endsAt);
    if (receiveDate > endsAt) return false;
  }

  return true;
}

export function incomeContributionThisMonth(income: Income, now = new Date()) {
  if (!isIncomeReceivedThisMonth(income, now)) return 0;
  return monthlyAmount(income.amount, income.frequency);
}
