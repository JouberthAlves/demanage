import { Prisma } from '@/generated/prisma/client';
import { dayKeyInSaoPaulo, dayKeyOfDate, todayKeyInSaoPaulo } from '@/lib/civil-date';
import { getPatrimonyHistory } from '@/lib/patrimony';
import { prisma } from '@/lib/prisma';
import { listEntries } from '@/services/entries';
import { listExpenses } from '@/services/expenses';
import { listPiggyCashMovements } from '@/services/piggy-banks';

type Day = string | Date | null | undefined;
type IncomeRow = {
  amount: Prisma.Decimal | number;
  frequency: string;
  type: string;
  receiveDay?: number | null;
  startsAt?: Day;
  endsAt?: Day;
  date?: Day;
  receiptHoldForMonth?: string | null;
  receivedForMonth?: string | null;
};
type ExpenseRow = {
  amount: Prisma.Decimal | number;
  frequency: string;
  dueDay?: number | null;
  startsAt?: Day;
  endsAt?: Day;
  occurredAt?: Day;
  paidForMonth?: string | null;
  cardId?: string | null;
  isInvoice?: boolean;
  splits?: Array<{ kind: string; amount: Prisma.Decimal | number }>;
  payments?: Array<{ paidAt: Day; amount: Prisma.Decimal | number }>;
};
type PiggyCashMovement = { type: string; amount: Prisma.Decimal | number; date: Day };

function key(date: Day): string | null {
  if (!date) return null;
  return date instanceof Date ? dayKeyOfDate(date) : date.slice(0, 10);
}

function timestampKey(date: Day): string | null {
  if (!date) return null;
  if (typeof date === 'string' && !date.includes('T')) return key(date);
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : dayKeyInSaoPaulo(parsed);
}

function cash(expense: ExpenseRow) {
  if (expense.splits?.length) {
    return expense.splits.reduce((total, split) => split.kind === 'pix'
      ? total.plus(split.amount) : total, new Prisma.Decimal(0));
  }
  return expense.cardId ? new Prisma.Decimal(0) : new Prisma.Decimal(expense.amount);
}

/** Same current-month schedule and cash-share semantics as the Dashboard. */
export function calculateMonthlyCash({ today, entries, expenses, movements }: {
  today: string;
  entries: IncomeRow[];
  expenses: ExpenseRow[];
  movements: PiggyCashMovement[];
}) {
  const month = today.slice(0, 7);
  const [year, number] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const scheduled = (day?: number | null) => `${month}-${String(Math.min(Math.max(day ?? 1, 1), end)).padStart(2, '0')}`;
  const active = (day: string, row: { startsAt?: Day; endsAt?: Day }) =>
    (!key(row.startsAt) || day >= key(row.startsAt)!) &&
    (!key(row.endsAt) || day <= key(row.endsAt)!);
  const frequencyAmount = (value: Prisma.Decimal | number, frequency: string) =>
    new Prisma.Decimal(value).mul(frequency === 'semanal' ? 4 : 1);

  let income = new Prisma.Decimal(0);
  let outflow = new Prisma.Decimal(0);
  for (const entry of entries) {
    if (entry.frequency === 'unica') {
      const day = key(entry.date);
      if (day && day.slice(0, 7) === month && day <= today) income = income.plus(entry.amount);
      continue;
    }
    const day = scheduled(entry.receiveDay);
    const salary = entry.type === 'salario' && entry.frequency === 'mensal';
    if (salary && entry.receivedForMonth === month) {
      income = income.plus(frequencyAmount(entry.amount, entry.frequency));
      continue;
    }
    if (!active(day, entry)) continue;
    if (salary && entry.receiptHoldForMonth === month) {
      continue;
    } else if (day <= today) {
      income = income.plus(frequencyAmount(entry.amount, entry.frequency));
    }
  }
  for (const expense of expenses) {
    if (expense.isInvoice) {
      for (const payment of expense.payments ?? []) {
        const paidDay = timestampKey(payment.paidAt);
        if (paidDay?.slice(0, 7) === month && paidDay <= today) {
          outflow = outflow.plus(payment.amount);
        }
      }
      continue;
    }
    if (expense.frequency === 'unica') {
      const day = key(expense.occurredAt);
      if (day && day.slice(0, 7) === month && day <= today) outflow = outflow.plus(cash(expense));
      continue;
    }
    const day = scheduled(expense.dueDay);
    if (active(day, expense) && (day <= today || expense.paidForMonth === month)) {
      outflow = outflow.plus(frequencyAmount(cash(expense), expense.frequency));
    }
  }
  for (const movement of movements) {
    const day = key(movement.date);
    if (!day || day.slice(0, 7) !== month || day > today) continue;
    if (movement.type === 'withdraw') income = income.plus(movement.amount);
    else if (movement.type === 'deposit') outflow = outflow.plus(movement.amount);
  }
  return {
    month,
    incomeBrl: income.toFixed(2),
    expensesBrl: outflow.toFixed(2),
    balanceBrl: income.minus(outflow).toFixed(2),
  };
}

/** No market quote or PatrimonySettings prerequisite for Dashboard's monthly balance. */
export async function getFinancialOverview(userId: string, now = new Date()) {
  const [entries, expenses, movements, settings] = await Promise.all([
    listEntries(userId), listExpenses(userId), listPiggyCashMovements(userId),
    prisma.patrimonySettings.findUnique({ where: { userId }, select: { id: true } }),
  ]);
  const monthly = calculateMonthlyCash({ today: todayKeyInSaoPaulo(now), entries, expenses, movements });
  if (!settings) return { monthly, patrimony: { status: 'not_configured' as const } };
  try {
    const { summary, stale } = await getPatrimonyHistory(userId);
    return { monthly, patrimony: { status: 'available' as const, summary, stale } };
  } catch {
    return { monthly, patrimony: { status: 'unavailable' as const } };
  }
}
