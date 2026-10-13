import { nextClosingOnOrAfter } from '@/lib/billing/calendar';
import type { CycleWindow } from '@/lib/billing/charges';
import { type DayKey, dayKeyInSaoPaulo, dayKeyOfDate } from '@/lib/civil-date';

/** Structural subset of Card so this module stays pure. */
export type CycleCard = {
  closingDay: number;
  createdAt: Date;
  lastInvoicedOn: Date | null;
  minimumNextClosingOn: Date | null;
};

/**
 * The billing window open now for `card`: from the last invoiced day to the
 * NEXT closing. It can span more than a month when the closing day changed or
 * a closing was skipped (minimumNextClosingOn).
 */
export function currentCycleWindow(
  card: CycleCard,
  todayKey: DayKey,
): CycleWindow {
  const periodStartKey = card.lastInvoicedOn
    ? dayKeyOfDate(card.lastInvoicedOn)
    : dayKeyInSaoPaulo(card.createdAt);
  const minimumKey = card.minimumNextClosingOn
    ? dayKeyOfDate(card.minimumNextClosingOn)
    : todayKey;
  const closingKey = nextClosingOnOrAfter(
    card.closingDay,
    periodStartKey,
    minimumKey > todayKey ? minimumKey : todayKey,
  );
  return {
    periodStartKey,
    closingKey,
    includePeriodStart: card.lastInvoicedOn == null,
  };
}
