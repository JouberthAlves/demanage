import {
  addDaysToKey,
  dayKeyToDate,
  todayKeyInSaoPaulo,
} from '@/lib/civil-date';

import { type BillingCardState, planCardBilling } from './plan';

/**
 * Without a persisted history of amount/splits, a late billing run must not
 * calculate old obligations from an expense changed after those obligations.
 * Query this inside the same per-user write lock as the expense mutation.
 */
export function cardsWithUnclosedBilling(
  cards: BillingCardState[],
  now: Date = new Date(),
): string[] {
  const cutoff = dayKeyToDate(addDaysToKey(todayKeyInSaoPaulo(now), -1));
  return cards
    .filter(
      (card) => planCardBilling(card, [], cutoff, now).cardUpdate !== null,
    )
    .map((card) => card.id);
}
