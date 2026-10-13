import { Prisma } from '@/generated/prisma/client';
import {
  addDaysToKey,
  compareDayKeys,
  type DayKey,
  dayKeyInSaoPaulo,
  dayKeyOfDate,
  dayKeyToDate,
} from '@/lib/civil-date';
import { toMoney } from '@/lib/money';

import { formatPtBrDayKey, listClosingDayKeys } from './calendar';
import {
  type BillableExpense,
  chargesTotalDecimal,
  lateOneOffsDecimal,
} from './charges';

export type BillingCardState = {
  id: string;
  closingDay: number;
  pendingClosingDay: number | null;
  pendingClosingDaySetAt: Date | null;
  minimumNextClosingOn: Date | null;
  lastInvoicedOn: Date | null;
  lastBillingProcessedAt: Date | null;
  createdAt: Date;
};

export type PlannedInvoice = {
  closingOn: Date;
  periodStart: Date;
  amount: Prisma.Decimal;
  notes: string;
};

export type CardUpdate = {
  lastInvoicedOn: Date;
  lastBillingProcessedAt: Date;
  closingDay?: number;
  pendingClosingDay?: number | null;
  pendingClosingDaySetAt?: Date | null;
  minimumNextClosingOn?: Date | null;
};

/** A closing-day change cannot produce a cycle shorter than this. */
export const MIN_CYCLE_DAYS_AFTER_CLOSING_CHANGE = 28;

/**
 * Pure planner: every closing of `card` up to `cutoff` (yesterday in Sao
 * Paulo), the invoice each one produces and the final card state. The DB
 * layer (run.ts) just persists the plan, which keeps it unit-testable.
 */
export function planCardBilling(
  card: BillingCardState,
  expenses: BillableExpense[],
  cutoff: Date,
  now: Date,
): { invoices: PlannedInvoice[]; cardUpdate: CardUpdate | null } {
  const invoices: PlannedInvoice[] = [];
  const cutoffKey = dayKeyOfDate(cutoff);

  let periodStartKey: DayKey = card.lastInvoicedOn
    ? dayKeyOfDate(card.lastInvoicedOn)
    : dayKeyInSaoPaulo(card.createdAt);
  let lastBillingProcessedAt = card.lastBillingProcessedAt;
  let hasClosedCycle = card.lastInvoicedOn != null;
  let closingDay = card.closingDay;
  let pendingClosingDay = card.pendingClosingDay;
  let includePeriodStart = card.lastInvoicedOn == null;
  const pendingSetKey = card.pendingClosingDaySetAt
    ? dayKeyInSaoPaulo(card.pendingClosingDaySetAt)
    : null;
  let minimumNextClosingKey: DayKey | null = card.minimumNextClosingOn
    ? dayKeyOfDate(card.minimumNextClosingOn)
    : null;

  let update: CardUpdate | null = null;

  while (true) {
    const closingKey = listClosingDayKeys(
      closingDay,
      periodStartKey,
      cutoffKey,
    ).find(
      (candidate) =>
        !minimumNextClosingKey ||
        compareDayKeys(candidate, minimumNextClosingKey) >= 0,
    );
    if (!closingKey) break;

    const cycleAmount = chargesTotalDecimal(expenses, card.id, {
      periodStartKey,
      closingKey,
      includePeriodStart,
    });
    const lateAdjustment =
      hasClosedCycle && lastBillingProcessedAt
        ? lateOneOffsDecimal(
            expenses,
            card.id,
            dayKeyToDate(periodStartKey),
            lastBillingProcessedAt,
          )
        : new Prisma.Decimal(0);
    const amount = toMoney(cycleAmount.plus(lateAdjustment));

    if (amount.gt(0)) {
      invoices.push({
        closingOn: dayKeyToDate(closingKey),
        periodStart: dayKeyToDate(periodStartKey),
        amount,
        notes: lateAdjustment.gt(0)
          ? `Fechamento ${formatPtBrDayKey(closingKey)} · inclui compras retroativas informadas após o fechamento anterior`
          : `Fechamento ${formatPtBrDayKey(closingKey)}`,
      });
    }

    const next: CardUpdate = {
      ...(update ?? {}),
      lastInvoicedOn: dayKeyToDate(closingKey),
      lastBillingProcessedAt: now,
    };

    if (
      pendingClosingDay != null &&
      (!pendingSetKey || compareDayKeys(closingKey, pendingSetKey) >= 0)
    ) {
      closingDay = pendingClosingDay;
      next.closingDay = closingDay;
      next.pendingClosingDay = null;
      next.pendingClosingDaySetAt = null;
      minimumNextClosingKey = addDaysToKey(
        closingKey,
        MIN_CYCLE_DAYS_AFTER_CLOSING_CHANGE,
      );
      next.minimumNextClosingOn = dayKeyToDate(minimumNextClosingKey);
      pendingClosingDay = null;
    } else if (
      minimumNextClosingKey &&
      compareDayKeys(closingKey, minimumNextClosingKey) >= 0
    ) {
      minimumNextClosingKey = null;
      next.minimumNextClosingOn = null;
    }

    update = next;
    lastBillingProcessedAt = now;
    hasClosedCycle = true;
    periodStartKey = closingKey;
    includePeriodStart = false;
  }

  return { invoices, cardUpdate: update };
}
