import { Prisma } from '@/generated/prisma/client';
import { dayKeyInSaoPaulo, dayKeyOfDate, todayKeyInSaoPaulo } from '@/lib/civil-date';
import { getPatrimonyHistory } from '@/lib/patrimony';
import { prisma } from '@/lib/prisma';
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
  archivedAt?: Day;
  receipts?: Array<{ month: string; amount: Prisma.Decimal | number; receivedAt: Day }>;
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
  archivedAt?: Day;
  splits?: Array<{ kind: string; amount: Prisma.Decimal | number }>;
  payments?: Array<{ month?: string; paidAt: Day; amount: Prisma.Decimal | number }>;
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

/** Current-month schedule fallback, overridden by immutable cash event records. */
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
    for (const receipt of entry.receipts ?? []) {
      const receivedDay = timestampKey(receipt.receivedAt);
      if (receivedDay?.slice(0, 7) === month && receivedDay <= today) {
        income = income.plus(receipt.amount);
      }
    }
    // Archived records remain in the ledger, but create no future schedule.
    if (entry.archivedAt) continue;
    if (entry.frequency === 'unica') {
      if (entry.receipts?.length) continue;
      const day = key(entry.date);
      if (day && day.slice(0, 7) === month && day <= today) income = income.plus(entry.amount);
      continue;
    }
    const day = scheduled(entry.receiveDay);
    const salary = entry.type === 'salario' && entry.frequency === 'mensal';
    if (salary && entry.receipts?.some((receipt) => receipt.month === month)) continue;
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
    for (const payment of expense.payments ?? []) {
      const paidDay = timestampKey(payment.paidAt);
      if (paidDay?.slice(0, 7) === month && paidDay <= today) {
        outflow = outflow.plus(payment.amount);
      }
    }
    if (expense.archivedAt || expense.isInvoice) continue;
    if (expense.frequency === 'unica') {
      if (expense.payments?.length) continue;
      const day = key(expense.occurredAt);
      if (day && day.slice(0, 7) === month && day <= today) outflow = outflow.plus(cash(expense));
      continue;
    }
    // A cycle paid early belongs to its paidAt month, never to its due month.
    if (expense.payments?.some((payment) => payment.month === month)) continue;
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

/** Read the full manual cash ledger, including archived parents, separately from CRUD lists. */
export async function getFinancialOverview(userId: string, now = new Date()) {
  const [entries, expenses, movements, settings] = await Promise.all([
    prisma.entry.findMany({
      where: { userId, systemOrigin: 'manual' },
      select: {
        amount: true, frequency: true, type: true, receiveDay: true,
        startsAt: true, endsAt: true, date: true, archivedAt: true,
        receiptHoldForMonth: true, receivedForMonth: true,
        receipts: { select: { month: true, amount: true, receivedAt: true } },
      },
    }),
    prisma.expense.findMany({
      where: { userId, systemOrigin: 'manual' },
      select: {
        amount: true, frequency: true, dueDay: true, startsAt: true,
        endsAt: true, occurredAt: true, paidForMonth: true, cardId: true,
        isInvoice: true, archivedAt: true,
        splits: { select: { kind: true, amount: true } },
        payments: { select: { month: true, amount: true, paidAt: true } },
      },
    }),
    listPiggyCashMovements(userId),
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
