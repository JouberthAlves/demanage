import {
  addDaysToKey,
  compareDayKeys,
  dayKeyInSaoPaulo,
  dayKeyOfDate,
  diffDays,
} from '@/lib/civil-date';

import {
  type BillableExpense,
  chargeAmountDecimal,
  chargeOccurrences,
  splitShareFor,
} from './charges';

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

/**
 * A card's lastInvoicedOn is a durable processed-through date even if its
 * invoice amount was zero. Existing invoice rows cannot identify individual
 * recurring occurrences, so compare the actual pre/post billing projections.
 * Financial revisions on the SAME schedule and card allocation are allowed;
 * they use immutable obligation versions for later unbilled cycles.
 */
export function hasSettledRecurringMutation(
  before: BillableExpense,
  after: BillableExpense,
  cards: Array<{ id: string; lastInvoicedOn: Date | null; createdAt?: Date }>,
  effectiveMonth: string,
): boolean {
  const datePart = (value: Date | null) => value ? dayKeyOfDate(value) : null;
  const occurrenceCalendarChanged = before.frequency !== after.frequency ||
    before.dueDay !== after.dueDay ||
    datePart(before.startsAt) !== datePart(after.startsAt);
  const scheduleChanged = occurrenceCalendarChanged ||
    datePart(before.endsAt) !== datePart(after.endsAt);

  const effectiveTerms = (expense: BillableExpense): BillableExpense => {
    const active = expense.obligationVersions
      ?.filter((version) => version.effectiveMonth <= effectiveMonth)
      .sort((a, b) => b.sequence - a.sequence)[0];
    return active ? { ...expense, ...active } : expense;
  };
  const oldTerms = effectiveTerms(before);
  const newTerms = effectiveTerms(after);
  const monthStart = `${effectiveMonth}-01`;
  const [year, month] = effectiveMonth.split('-').map(Number);
  const monthEnd = dayKeyOfDate(new Date(Date.UTC(year, month, 0, 12)));
  const startKey = (expense: BillableExpense) => expense.startsAt
    ? dayKeyOfDate(expense.startsAt)
    : dayKeyInSaoPaulo(expense.createdAt);
  const earliestStart = [
    startKey(before),
    startKey(after),
  ].sort()[0];

  for (const card of cards) {
    if (!card.lastInvoicedOn) continue;
    const closedThrough = dayKeyOfDate(card.lastInvoicedOn);
    const historyStart = card.createdAt
      ? [dayKeyInSaoPaulo(card.createdAt), earliestStart].sort().at(-1)!
      : earliestStart;
    if (compareDayKeys(historyStart, closedThrough) > 0) continue;

    const oldShare = splitShareFor(oldTerms, { kind: 'card', cardId: card.id });
    const newShare = splitShareFor(newTerms, { kind: 'card', cardId: card.id });
    const allocationChanged = !oldShare.mul(newTerms.amount).equals(newShare.mul(oldTerms.amount));
    if (allocationChanged && compareDayKeys(closedThrough, monthStart) >= 0) {
      const closingKey = compareDayKeys(closedThrough, monthEnd) < 0 ? closedThrough : monthEnd;
      const cycleStart = compareDayKeys(historyStart, monthStart) > 0 ? historyStart : monthStart;
      if (compareDayKeys(cycleStart, closingKey) <= 0) {
        const window = { periodStartKey: cycleStart, closingKey, includePeriodStart: true };
        const priorClosed = chargeAmountDecimal(before, card.id, window);
        const proposedClosed = chargeAmountDecimal(after, card.id, window);
        if (priorClosed.gt(0) || proposedClosed.gt(0)) return true;
      }
    }

    if (scheduleChanged) {
      const window = { periodStartKey: historyStart, closingKey: closedThrough, includePeriodStart: true };
      const previousClosed = chargeAmountDecimal(before, card.id, window);
      const proposedClosed = chargeAmountDecimal(after, card.id, window);
      if (occurrenceCalendarChanged) {
        if (previousClosed.lte(0) && proposedClosed.lte(0)) continue;
        // Calendar fields are live across every historical version. Aggregate
        // sums can match despite moving settled dates between closed cycles;
        // compare the occurrence footprint using the real billing calculator.
        // Older unverifiable histories fail closed rather than hold the user
        // row lock for an unbounded number of daily projections.
        if (diffDays(closedThrough, historyStart) > 10_000) return true;
        for (let day = historyStart; compareDayKeys(day, closedThrough) <= 0; day = addDaysToKey(day, 1)) {
          const daily = { periodStartKey: day, closingKey: day, includePeriodStart: true };
          const priorOccurrence = chargeAmountDecimal(before, card.id, daily).gt(0);
          const proposedOccurrence = chargeAmountDecimal(after, card.id, daily).gt(0);
          if (priorOccurrence !== proposedOccurrence) return true;
        }
      } else if (!previousClosed.equals(proposedClosed)) {
        // An end-date extension entirely after the closed-through boundary
        // remains a legitimate edit; a backdated change does not.
        return true;
      }
    }
  }
  return false;
}
