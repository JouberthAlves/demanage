import { Prisma } from '@/generated/prisma/client';
import {
  addDaysToKey,
  clampDayToMonth,
  compareDayKeys,
  type DayKey,
  dayKeyInSaoPaulo,
  dayKeyOfDate,
  diffDays,
  formatDayKey,
  parseDayKey,
  weekdayOfKey,
} from '@/lib/civil-date';
import type { MoneyInput } from '@/lib/money';

/** Structural subset of Expense / ExpenseSplit so this module stays pure. */
export type BillableSplit = {
  kind: 'card' | 'pix' | string;
  cardId: string | null;
  amount: MoneyInput;
};

export type BillableExpense = {
  amount: MoneyInput;
  cardId: string | null;
  isInvoice: boolean;
  frequency: string;
  startsAt: Date | null;
  endsAt: Date | null;
  occurredAt: Date | null;
  createdAt: Date;
  archivedAt?: Date | null;
  splits?: BillableSplit[];
};

export type SplitTarget =
  | { kind: 'card'; cardId: string }
  | { kind: 'pix' }
  /** Money that leaves the cash balance directly (no card involved). */
  | { kind: 'cash' };

const ZERO = new Prisma.Decimal(0);

/**
 * THE split-share rule, shared by billing, card limits and patrimony:
 * how much of one occurrence of `expense` belongs to `target`.
 * - card: sum of that card's splits, else the whole amount when the legacy
 *   denormalised expense.cardId matches, else 0.
 * - pix / cash: sum of pix splits when splits exist; with no splits it is the
 *   whole amount unless the expense is on a card (then 0).
 */
export function splitShareFor(
  expense: BillableExpense,
  target: SplitTarget,
): Prisma.Decimal {
  const splits = expense.splits ?? [];

  if (target.kind === 'card') {
    const cardSplits = splits.filter(
      (split) => split.kind === 'card' && split.cardId === target.cardId,
    );
    if (cardSplits.length > 0) {
      return cardSplits.reduce(
        (sum, split) => sum.plus(split.amount),
        ZERO,
      );
    }
    return expense.cardId === target.cardId
      ? new Prisma.Decimal(expense.amount)
      : ZERO;
  }

  if (splits.length > 0) {
    return splits
      .filter((split) => split.kind === 'pix')
      .reduce((sum, split) => sum.plus(split.amount), ZERO);
  }
  if (expense.cardId) return ZERO;
  return new Prisma.Decimal(expense.amount);
}

export type CycleWindow = {
  /** Last invoiced day (exclusive lower bound unless includePeriodStart). */
  periodStartKey: DayKey;
  closingKey: DayKey;
  includePeriodStart: boolean;
};

function recurringStartKey(expense: BillableExpense): DayKey {
  return expense.startsAt
    ? dayKeyOfDate(expense.startsAt)
    : dayKeyInSaoPaulo(expense.createdAt);
}

function oneOffKey(expense: BillableExpense): DayKey {
  return dayKeyInSaoPaulo(expense.occurredAt ?? expense.createdAt);
}

/** Number of Mondays (etc.) with the weekday of `anchorKey` in [lo, hi]. */
export function countWeeklyOccurrences(
  anchorKey: DayKey,
  loKey: DayKey,
  hiKey: DayKey,
): number {
  const first = compareDayKeys(loKey, anchorKey) >= 0 ? loKey : anchorKey;
  if (compareDayKeys(first, hiKey) > 0) return 0;
  const shift = (weekdayOfKey(anchorKey) - weekdayOfKey(first) + 7) % 7;
  const firstOccurrence = addDaysToKey(first, shift);
  if (compareDayKeys(firstOccurrence, hiKey) > 0) return 0;
  return Math.floor(diffDays(hiKey, firstOccurrence) / 7) + 1;
}

/**
 * Number of monthly occurrences (day-of-month of `anchorKey`, clamped to the
 * month length) falling in [lo, hi] and not before the anchor.
 */
export function countMonthlyOccurrences(
  anchorKey: DayKey,
  loKey: DayKey,
  hiKey: DayKey,
): number {
  const anchor = parseDayKey(anchorKey);
  const lo = parseDayKey(compareDayKeys(loKey, anchorKey) >= 0 ? loKey : anchorKey);
  const hi = parseDayKey(hiKey);
  if (!anchor || !lo || !hi) return 0;
  const effectiveLo = compareDayKeys(loKey, anchorKey) >= 0 ? loKey : anchorKey;
  if (compareDayKeys(effectiveLo, hiKey) > 0) return 0;

  let count = 0;
  let year = lo.year;
  let month = lo.monthIndex;
  while (year < hi.year || (year === hi.year && month <= hi.monthIndex)) {
    const occurrence = formatDayKey(
      year,
      month,
      clampDayToMonth(year, month, anchor.day),
    );
    if (
      compareDayKeys(occurrence, effectiveLo) >= 0 &&
      compareDayKeys(occurrence, hiKey) <= 0
    ) {
      count += 1;
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return count;
}

/**
 * How many times `expense` is charged inside one billing cycle.
 * - invoices are never charged on a card;
 * - one-offs: once, if dated inside the cycle;
 * - weekly: real weekday occurrences from startsAt in the cycle (4 or 5);
 * - monthly: real day-of-month occurrences in the cycle, so a cycle that
 *   spans two months (skipped closing) bills both.
 * Recurring charges stop at endsAt and at the archive day.
 */
export function chargeOccurrences(
  expense: BillableExpense,
  window: CycleWindow,
): number {
  if (expense.isInvoice) return 0;
  const { periodStartKey, closingKey, includePeriodStart } = window;
  const lowerInclusive = includePeriodStart
    ? periodStartKey
    : addDaysToKey(periodStartKey, 1);

  if (expense.frequency === 'unica') {
    const key = oneOffKey(expense);
    return compareDayKeys(key, lowerInclusive) >= 0 &&
      compareDayKeys(key, closingKey) <= 0
      ? 1
      : 0;
  }

  const startKey = recurringStartKey(expense);
  let hi = closingKey;
  if (expense.endsAt) {
    const endsKey = dayKeyOfDate(expense.endsAt);
    if (compareDayKeys(endsKey, hi) < 0) hi = endsKey;
  }
  if (expense.archivedAt) {
    const archivedKey = dayKeyInSaoPaulo(expense.archivedAt);
    if (compareDayKeys(archivedKey, hi) < 0) hi = archivedKey;
  }
  if (compareDayKeys(lowerInclusive, hi) > 0) return 0;

  return expense.frequency === 'semanal'
    ? countWeeklyOccurrences(startKey, lowerInclusive, hi)
    : countMonthlyOccurrences(startKey, lowerInclusive, hi);
}

export function chargeAmountDecimal(
  expense: BillableExpense,
  cardId: string,
  window: CycleWindow,
): Prisma.Decimal {
  const occurrences = chargeOccurrences(expense, window);
  if (occurrences <= 0) return ZERO;
  return splitShareFor(expense, { kind: 'card', cardId }).mul(occurrences);
}

export function chargesTotalDecimal(
  expenses: BillableExpense[],
  cardId: string,
  window: CycleWindow,
): Prisma.Decimal {
  return expenses.reduce(
    (sum, expense) => sum.plus(chargeAmountDecimal(expense, cardId, window)),
    ZERO,
  );
}

function windowFromDates(
  closingOn: Date,
  periodStart: Date,
  includePeriodStart: boolean,
): CycleWindow {
  return {
    periodStartKey: dayKeyOfDate(periodStart),
    closingKey: dayKeyOfDate(closingOn),
    includePeriodStart,
  };
}

export function chargeAmountForClosing(
  expense: BillableExpense,
  cardId: string,
  closingOn: Date,
  periodStart: Date,
  includePeriodStart = false,
) {
  return chargeAmountDecimal(
    expense,
    cardId,
    windowFromDates(closingOn, periodStart, includePeriodStart),
  ).toNumber();
}

export function chargesTotalForClosing(
  expenses: BillableExpense[],
  cardId: string,
  closingOn: Date,
  periodStart: Date,
  includePeriodStart = false,
) {
  return chargesTotalDecimal(
    expenses,
    cardId,
    windowFromDates(closingOn, periodStart, includePeriodStart),
  ).toNumber();
}

/**
 * A one-off purchase entered after a card close but dated on or before that
 * close is included as an adjustment in the next invoice. The per-card
 * processing timestamp prevents the same adjustment from being billed twice.
 */
export function lateOneOffsDecimal(
  expenses: BillableExpense[],
  cardId: string,
  closedThrough: Date,
  processedAt: Date,
): Prisma.Decimal {
  const closedThroughKey = dayKeyOfDate(closedThrough);
  return expenses.reduce((sum, expense) => {
    if (
      expense.isInvoice ||
      expense.frequency !== 'unica' ||
      expense.createdAt <= processedAt
    ) {
      return sum;
    }
    if (compareDayKeys(oneOffKey(expense), closedThroughKey) > 0) return sum;
    return sum.plus(splitShareFor(expense, { kind: 'card', cardId }));
  }, ZERO);
}

export function lateOneOffsTotalForClosing(
  expenses: BillableExpense[],
  cardId: string,
  closedThrough: Date,
  processedAt: Date,
) {
  return lateOneOffsDecimal(
    expenses,
    cardId,
    closedThrough,
    processedAt,
  ).toNumber();
}
