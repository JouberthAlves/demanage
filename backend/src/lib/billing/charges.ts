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

/**
 * Most times one expense can charge a card inside a single billing cycle.
 * A weekly expense hits a cycle 4 or 5 times (a cycle is a month), so the limit
 * check reserves the worst case. Product rule: a new/edited expense must fit
 * the card for a full cycle (card share x this number).
 */
export const MAX_CHARGES_PER_CYCLE = {
  unica: 1,
  mensal: 1,
  semanal: 5,
} as const;

export function maxChargesPerCycle(frequency: string): number {
  return (
    (MAX_CHARGES_PER_CYCLE as Record<string, number>)[frequency] ?? 1
  );
}

export type CycleWindow = {
  /** Last invoiced day (exclusive lower bound unless includePeriodStart). */
  periodStartKey: DayKey;
  closingKey: DayKey;
  includePeriodStart: boolean;
};

export type MaxChargesPerCycle = {
  unica: number;
  mensal: number;
  semanal: number;
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

/**
 * Worst-case number of charges of `frequency` inside a concrete cycle window,
 * over every possible anchor (weekday for weekly, day-of-month 1..31 for
 * monthly, honouring month-end clamping). One-offs are always 1.
 */
export function worstCaseChargesInWindow(
  frequency: string,
  window: CycleWindow,
): number {
  if (frequency === 'unica') return 1;
  const lo = window.includePeriodStart
    ? window.periodStartKey
    : addDaysToKey(window.periodStartKey, 1);
  const hi = window.closingKey;
  if (compareDayKeys(lo, hi) > 0) return 0;

  let worst = 0;
  if (frequency === 'semanal') {
    // Anchor on/before `lo` so only the weekday matters.
    for (let i = 0; i < 7; i += 1) {
      const anchor = addDaysToKey(lo, -i);
      worst = Math.max(worst, countWeeklyOccurrences(anchor, lo, hi));
    }
    return worst;
  }
  if (frequency === 'mensal') {
    const loDate = parseDayKey(lo);
    if (!loDate) return 0;
    for (let day = 1; day <= 31; day += 1) {
      // January (31 days) of the previous year: before the window, and the
      // anchor keeps its real day-of-month so clamping happens per month.
      const anchor = formatDayKey(loDate.year - 1, 0, day);
      worst = Math.max(worst, countMonthlyOccurrences(anchor, lo, hi));
    }
    return worst;
  }
  return 1;
}

/**
 * Charges per cycle used to validate card limits: the worst case inside the
 * card's CURRENT open window, never below the constant of a normal cycle (a
 * short remaining window must not lower the bar).
 */
export function maxChargesForWindow(window: CycleWindow): MaxChargesPerCycle {
  return {
    unica: 1,
    mensal: Math.max(
      MAX_CHARGES_PER_CYCLE.mensal,
      worstCaseChargesInWindow('mensal', window),
    ),
    semanal: Math.max(
      MAX_CHARGES_PER_CYCLE.semanal,
      worstCaseChargesInWindow('semanal', window),
    ),
  };
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
