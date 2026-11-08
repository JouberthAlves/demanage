import { Prisma } from '@/generated/prisma/client';
import { countWeeklyOccurrences } from '@/lib/billing/charges';
import { dayKeyInSaoPaulo, dayKeyOfDate, todayKeyInSaoPaulo } from '@/lib/civil-date';
import { getPatrimonyHistory } from '@/lib/patrimony';
import { prisma } from '@/lib/prisma';

export const MCP_FINANCIAL_READ_PAGE = 128;
export const MCP_PATRIMONY_SNAPSHOT_ROW_BUDGET = 4096;

/** Stable ID cursor bounds every Prisma result, including child ledgers. */
export async function eachPage<T extends { id: string }>(
  load: (cursor?: string) => Promise<T[]>,
  visit: (rows: T[]) => void | Promise<void>,
) {
  let cursor: string | undefined;
  while (true) {
    const rows = await load(cursor);
    if (rows.length > MCP_FINANCIAL_READ_PAGE) throw new Error('MCP financial page exceeded row budget');
    if (!rows.length) return;
    await visit(rows);
    if (rows.length < MCP_FINANCIAL_READ_PAGE) return;
    cursor = rows[rows.length - 1]!.id;
  }
}

type Day = string | Date | null | undefined;
type IncomeRow = {
  amount: Prisma.Decimal | number;
  frequency: string;
  type: string;
  receiveDay?: number | null;
  createdAt?: Day;
  startsAt?: Day;
  endsAt?: Day;
  date?: Day;
  receiptHoldForMonth?: string | null;
  salaryHolds?: Array<{ month: string }>;
  receivedForMonth?: string | null;
  archivedAt?: Day;
  receipts?: Array<{ month: string; amount: Prisma.Decimal | number; receivedAt: Day }>;
};
type ExpenseRow = {
  amount: Prisma.Decimal | number;
  frequency: string;
  dueDay?: number | null;
  createdAt?: Day;
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
  const weeklyAmount = (value: Prisma.Decimal | number, day: number | null | undefined, row: { startsAt?: Day; createdAt?: Day; endsAt?: Day }) => {
    // The first scheduled day fixes the weekday. Date-only schedule fields are
    // civil dates; receipt/payment timestamps are resolved separately below.
    const anchor = key(row.startsAt) ?? timestampKey(row.createdAt) ?? scheduled(day);
    const endKey = key(row.endsAt);
    const through = endKey && endKey < today ? endKey : today;
    return new Prisma.Decimal(value).mul(countWeeklyOccurrences(anchor, `${month}-01`, through));
  };

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
      // F09: a one-off receivable is only a forecast. Its settlement is
      // accounted for above using immutable receipt amount and receivedAt.
      // A due date alone is never evidence of realized cash.
      continue;
    }
    // A recorded receipt settles its own competence, possibly in another month.
    // Its immutable cash event has already been added above.
    if (entry.receipts?.some((receipt) => receipt.month === month)) continue;
    if (entry.frequency === 'semanal') {
      income = income.plus(weeklyAmount(entry.amount, entry.receiveDay, entry));
      continue;
    }
    const day = scheduled(entry.receiveDay);
    const salary = entry.type === 'salario' && entry.frequency === 'mensal';
    if (salary && entry.receivedForMonth === month) {
      income = income.plus(entry.amount);
      continue;
    }
    if (!active(day, entry)) continue;
    if (salary && (entry.salaryHolds
      ? entry.salaryHolds.some((hold) => hold.month === month)
      : entry.receiptHoldForMonth === month)) {
      continue;
    } else if (day <= today) {
      income = income.plus(entry.amount);
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
    if (expense.frequency === 'semanal') {
      outflow = outflow.plus(weeklyAmount(cash(expense), expense.dueDay, expense));
      continue;
    }
    const day = scheduled(expense.dueDay);
    if (active(day, expense) && (day <= today || expense.paidForMonth === month)) {
      outflow = outflow.plus(cash(expense));
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

/** Aggregate historical child events without accumulating account-sized arrays. */
async function readMonthlyCash(userId: string, today: string) {
  const month = today.slice(0, 7);
  const todayInstant = new Date(`${today}T12:00:00.000Z`);
  const pastInstant = new Date(0);
  let income = new Prisma.Decimal(0);
  let expenses = new Prisma.Decimal(0);

  await eachPage((cursor) => prisma.entry.findMany({
    where: { userId, systemOrigin: 'manual' },
    orderBy: { id: 'asc' }, take: MCP_FINANCIAL_READ_PAGE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true, amount: true, frequency: true, type: true, receiveDay: true, createdAt: true,
      startsAt: true, endsAt: true, date: true, archivedAt: true,
      receiptHoldForMonth: true, receivedForMonth: true,
      salaryHolds: { where: { month }, select: { month: true } },
    },
  }), async (entries) => {
    const receipts = new Map(entries.map(({ id }) => [id, {
      received: new Prisma.Decimal(0), settledMonth: false,
    }]));
    await eachPage((cursor) => prisma.entryReceipt.findMany({
      where: { entryId: { in: entries.map(({ id }) => id) } },
      orderBy: { id: 'asc' }, take: MCP_FINANCIAL_READ_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, entryId: true, month: true, amount: true, receivedAt: true },
    }), (rows) => {
      for (const row of rows) {
        const state = receipts.get(row.entryId)!;
        if (row.month === month) state.settledMonth = true;
        const date = dayKeyInSaoPaulo(row.receivedAt);
        if (date.slice(0, 7) === month && date <= today) {
          state.received = state.received.plus(row.amount);
        }
      }
    });
    const normalized = entries.map(({ id, ...entry }) => {
      const state = receipts.get(id)!;
      return { ...entry, receipts: [
        ...(state.settledMonth ? [{ month, amount: new Prisma.Decimal(0), receivedAt: pastInstant }] : []),
        ...(state.received.isZero() ? [] : [{ month: '', amount: state.received, receivedAt: todayInstant }]),
      ] };
    });
    income = income.plus(calculateMonthlyCash({ today, entries: normalized, expenses: [], movements: [] }).incomeBrl);
  });

  await eachPage((cursor) => prisma.expense.findMany({
    where: { userId, systemOrigin: 'manual', voidedAt: null },
    orderBy: { id: 'asc' }, take: MCP_FINANCIAL_READ_PAGE,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true, amount: true, frequency: true, dueDay: true, createdAt: true, startsAt: true,
      endsAt: true, occurredAt: true, paidForMonth: true, cardId: true,
      isInvoice: true, archivedAt: true,
    },
  }), async (rows) => {
    const parentIds = rows.map(({ id }) => id);
    const payments = new Map(parentIds.map((id) => [id, {
      paid: new Prisma.Decimal(0), settledMonth: false, any: false,
    }]));
    const splitAmounts = new Map(parentIds.map((id) => [id, {
      pix: new Prisma.Decimal(0), any: false,
    }]));
    await Promise.all([
      eachPage((cursor) => prisma.expensePayment.findMany({
        where: { expenseId: { in: parentIds } }, orderBy: { id: 'asc' }, take: MCP_FINANCIAL_READ_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, expenseId: true, month: true, amount: true, paidAt: true },
      }), (page) => {
        for (const payment of page) {
          const state = payments.get(payment.expenseId)!;
          state.any = true;
          if (payment.month === month) state.settledMonth = true;
          const date = dayKeyInSaoPaulo(payment.paidAt);
          if (date.slice(0, 7) === month && date <= today) state.paid = state.paid.plus(payment.amount);
        }
      }),
      eachPage((cursor) => prisma.expenseSplit.findMany({
        where: { expenseId: { in: parentIds } }, orderBy: { id: 'asc' }, take: MCP_FINANCIAL_READ_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, expenseId: true, kind: true, amount: true },
      }), (page) => {
        for (const split of page) {
          const state = splitAmounts.get(split.expenseId)!;
          state.any = true;
          if (split.kind === 'pix') state.pix = state.pix.plus(split.amount);
        }
      }),
    ]);
    const normalized = rows.map(({ id, ...expense }) => {
      const state = payments.get(id)!;
      const split = splitAmounts.get(id)!;
      return { ...expense,
        splits: split.any ? [{ kind: 'pix', amount: split.pix }] : [],
        payments: [
          ...(state.settledMonth ? [{ month, amount: new Prisma.Decimal(0), paidAt: pastInstant }] : []),
          ...(state.paid.isZero() ? [] : [{ month: '', amount: state.paid, paidAt: todayInstant }]),
          ...(!state.settledMonth && state.any && state.paid.isZero()
            ? [{ month: '', amount: new Prisma.Decimal(0), paidAt: pastInstant }] : []),
        ],
      };
    });
    expenses = expenses.plus(calculateMonthlyCash({ today, entries: [], expenses: normalized, movements: [] }).expensesBrl);
  });

  // Piggy cash movements have date-only UTC civil days. Let PostgreSQL aggregate
  // only the current portion, preserving Decimal precision and linked-only rules.
  const dayAfter = new Date(`${today}T00:00:00.000Z`);
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const movements = await prisma.piggyTransaction.groupBy({
    by: ['type'],
    where: {
      userId, date: { gte: new Date(`${month}-01T00:00:00.000Z`), lt: dayAfter },
      OR: [
        { type: 'deposit', expenseId: { not: null } },
        { type: 'withdraw', entryId: { not: null } },
      ],
    },
    _sum: { amount: true },
  });
  for (const movement of movements) {
    if (movement.type === 'withdraw') income = income.plus(movement._sum.amount ?? 0);
    else if (movement.type === 'deposit') expenses = expenses.plus(movement._sum.amount ?? 0);
  }
  return {
    month, incomeBrl: income.toFixed(2), expensesBrl: expenses.toFixed(2),
    balanceBrl: income.minus(expenses).toFixed(2),
  };
}

/** Legacy patrimony snapshot still materializes its full graph in memory.
 * Gate that separate optional graph before calling it; the MCP cash balance
 * remains available even for accounts exceeding the patrimony snapshot budget.
 */
export async function patrimonyWithinHistoryBudget(userId: string, budget = MCP_PATRIMONY_SNAPSHOT_ROW_BUDGET) {
  const counts = await Promise.all([
    prisma.expense.count({ where: { userId, voidedAt: null } }),
    prisma.entry.count({ where: { userId } }),
    prisma.expenseSplit.count({ where: { expense: { userId, voidedAt: null } } }),
    prisma.expensePayment.count({ where: { expense: { userId, voidedAt: null } } }),
    prisma.entryReceipt.count({ where: { entry: { userId } } }),
    prisma.piggyTransaction.count({ where: { userId } }),
    prisma.assetTransaction.count({ where: { userId } }),
  ]);
  return counts.reduce((sum, count) => sum + count, 0) <= budget;
}

/** Read manual cash records including archived parents; bound each DB page. */
export async function getFinancialOverview(userId: string, now = new Date()) {
  const [monthly, settings] = await Promise.all([
    readMonthlyCash(userId, todayKeyInSaoPaulo(now)),
    prisma.patrimonySettings.findUnique({ where: { userId }, select: { id: true } }),
  ]);
  if (!settings) return { monthly, patrimony: { status: 'not_configured' as const } };
  try {
    if (!(await patrimonyWithinHistoryBudget(userId))) {
      return { monthly, patrimony: {
        status: 'unavailable' as const, reason: 'history_budget_exceeded' as const,
      } };
    }
    const { summary, stale } = await getPatrimonyHistory(userId);
    return { monthly, patrimony: { status: 'available' as const, summary, stale } };
  } catch {
    return { monthly, patrimony: { status: 'unavailable' as const } };
  }
}
