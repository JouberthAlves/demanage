import { dayKeyInSaoPaulo, dayKeyOfDate } from '@/lib/civil-date';

import { chargeOccurrences } from './charges';

/**
 * A freshly registered recurrence cannot silently skip charges in a card
 * cycle which was already invoiced. Calculate occurrences using the exact
 * existing billing rules (month-end clamping / weekly weekdays).
 */
export function hasRetroactiveClosedCardCharge(
  card: { createdAt: Date; lastInvoicedOn: Date | null },
  schedule: {
    frequency: 'mensal' | 'semanal';
    amount: string | number;
    startsAt: Date | null;
    endsAt: Date | null;
    dueDay: number | null;
  },
): boolean {
  if (!card.lastInvoicedOn) return false;
  const periodStartKey = dayKeyInSaoPaulo(card.createdAt);
  const closingKey = dayKeyOfDate(card.lastInvoicedOn);
  if (periodStartKey > closingKey) return false;
  return chargeOccurrences(
    {
      ...schedule,
      cardId: null,
      isInvoice: false,
      occurredAt: null,
      createdAt: card.createdAt,
    },
    { periodStartKey, closingKey, includePeriodStart: true },
  ) > 0;
}
