import type { Card, Expense, ExpenseSplit } from '@prisma/client';

import { prisma } from '@/lib/prisma';

const BILLING_TIMEZONE = 'America/Sao_Paulo';

/** Dia civil YYYY-MM-DD (comparações estáveis, sem drift de fuso). */
type DayKey = string;

type ExpenseForBilling = Expense & {
  splits?: ExpenseSplit[];
};

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function toDayKey(year: number, monthIndex: number, day: number): DayKey {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

function formatPtBrDayKey(dayKey: DayKey) {
  const [year, month, day] = dayKey.split('-');
  return `${day}/${month}/${year}`;
}

/** Instant → dia civil em America/Sao_Paulo. */
function instantToSpDayKey(date: Date): DayKey {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BILLING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * Date-only persistido via Date.UTC (startsAt/endsAt/lastInvoicedOn)
 * → usa componentes UTC para não deslocar o dia no fuso SP.
 */
function dateOnlyToDayKey(date: Date): DayKey {
  return toDayKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Persiste um dia civil como meio-dia UTC (não muda de dia em SP/UTC). */
function dayKeyToUtcNoon(dayKey: DayKey) {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function compareDayKeys(a: DayKey, b: DayKey) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Calendário civil em America/Sao_Paulo. */
export function todayInSaoPaulo(now = new Date()): Date {
  const dayKey = instantToSpDayKey(now);
  return dayKeyToUtcNoon(dayKey);
}

function closingDayKeyInMonth(
  year: number,
  monthIndex: number,
  closingDay: number,
): DayKey {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const day = Math.min(closingDay, lastDay);
  return toDayKey(year, monthIndex, day);
}

/** Datas de fechamento estritamente após `after`, até `until` (inclusive). */
export function listDueClosingDates(
  closingDay: number,
  after: Date,
  until: Date,
) {
  const dates: Date[] = [];
  const endKey = dateOnlyToDayKey(until);
  const afterKey = dateOnlyToDayKey(after);

  let year = Number(afterKey.slice(0, 4));
  let month = Number(afterKey.slice(5, 7)) - 1;

  for (let i = 0; i < 48; i += 1) {
    const candidateKey = closingDayKeyInMonth(year, month, closingDay);
    if (
      compareDayKeys(candidateKey, afterKey) > 0 &&
      compareDayKeys(candidateKey, endKey) <= 0
    ) {
      dates.push(dayKeyToUtcNoon(candidateKey));
    }
    if (compareDayKeys(candidateKey, endKey) > 0) break;
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return dates;
}

function chargeBaseForClosing(
  expense: Expense,
  closingOn: Date,
  periodStart: Date,
) {
  if (expense.isInvoice) return 0;

  const closingKey = dateOnlyToDayKey(closingOn);
  const periodStartKey = dateOnlyToDayKey(periodStart);

  const startsKey = expense.startsAt
    ? dateOnlyToDayKey(expense.startsAt)
    : instantToSpDayKey(expense.createdAt);
  if (compareDayKeys(startsKey, closingKey) > 0) return 0;

  if (expense.endsAt) {
    const endsKey = dateOnlyToDayKey(expense.endsAt);
    if (compareDayKeys(endsKey, closingKey) < 0) return 0;
  }

  if (expense.frequency === 'unica') {
    const createdKey = instantToSpDayKey(expense.createdAt);
    if (
      compareDayKeys(createdKey, periodStartKey) <= 0 ||
      compareDayKeys(createdKey, closingKey) > 0
    ) {
      return 0;
    }
    return 1;
  }

  if (expense.frequency === 'semanal') return 4;
  return 1;
}

function cardShareAmount(expense: ExpenseForBilling, cardId: string) {
  const cardSplits =
    expense.splits?.filter(
      (split) => split.kind === 'card' && split.cardId === cardId,
    ) ?? [];

  if (cardSplits.length > 0) {
    return cardSplits.reduce((sum, split) => sum + Number(split.amount), 0);
  }

  if (expense.cardId === cardId) {
    return Number(expense.amount);
  }

  return 0;
}

export function chargeAmountForClosing(
  expense: ExpenseForBilling,
  cardId: string,
  closingOn: Date,
  periodStart: Date,
) {
  const multiplier = chargeBaseForClosing(expense, closingOn, periodStart);
  if (multiplier <= 0) return 0;
  return cardShareAmount(expense, cardId) * multiplier;
}

export function chargesTotalForClosing(
  expenses: ExpenseForBilling[],
  cardId: string,
  closingOn: Date,
  periodStart: Date,
) {
  return expenses.reduce(
    (sum, expense) =>
      sum + chargeAmountForClosing(expense, cardId, closingOn, periodStart),
    0,
  );
}

export async function processUserCardBilling(userId: string) {
  const today = todayInSaoPaulo();
  const cards = await prisma.card.findMany({
    where: { userId },
    include: {
      expenses: { include: { splits: true } },
      expenseSplits: {
        where: { kind: 'card' },
        include: { expense: { include: { splits: true } } },
      },
    },
  });

  let createdCount = 0;

  for (const card of cards) {
    const expenseMap = new Map<string, ExpenseForBilling>();
    for (const expense of card.expenses) {
      expenseMap.set(expense.id, expense);
    }
    for (const split of card.expenseSplits) {
      expenseMap.set(split.expense.id, split.expense);
    }
    const expenses = [...expenseMap.values()];

    let periodStart = card.lastInvoicedOn
      ? dayKeyToUtcNoon(dateOnlyToDayKey(card.lastInvoicedOn))
      : dayKeyToUtcNoon(instantToSpDayKey(card.createdAt));

    const dueDates = listDueClosingDates(card.closingDay, periodStart, today);

    for (const closingOn of dueDates) {
      const amount = chargesTotalForClosing(
        expenses,
        card.id,
        closingOn,
        periodStart,
      );

      const closingKey = dateOnlyToDayKey(closingOn);

      if (amount <= 0) {
        await prisma.card.update({
          where: { id: card.id },
          data: { lastInvoicedOn: closingOn },
        });
        periodStart = closingOn;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.expense.create({
          data: {
            userId,
            cardId: card.id,
            name: `Fatura do cartão ${card.name}`,
            amount,
            category: 'outro',
            frequency: 'unica',
            isInvoice: true,
            notes: `Fechamento ${formatPtBrDayKey(closingKey)}`,
          },
        });

        await tx.card.update({
          where: { id: card.id },
          data: { lastInvoicedOn: closingOn },
        });
      });

      periodStart = closingOn;
      createdCount += 1;
    }
  }

  return { createdCount };
}

export function serializeCard(card: Card) {
  return {
    id: card.id,
    name: card.name,
    limit: card.limit == null ? null : Number(card.limit),
    closingDay: card.closingDay,
    expiresAt: card.expiresAt,
    lastInvoicedOn: card.lastInvoicedOn,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    expired: card.expiresAt ? card.expiresAt.getTime() < Date.now() : false,
  };
}
