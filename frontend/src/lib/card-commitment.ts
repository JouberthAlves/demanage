import { buildCommittedByCard } from '@/lib/expense-splits';
import type { Card, RecurringExpense } from '@/types/finance';

export type CardCommitment = {
  id: string;
  name: string;
  expired: boolean;
  limit: number;
  committed: number;
  /** Raw percentage of the limit, may exceed 100. */
  percent: number;
};

/**
 * Per-card limit usage for cards with a limit. Uses the same billing-period
 * aware commitment as the profile page (weekly x4, closed invoices excluded).
 */
export function selectCardCommitments(
  expenses: RecurringExpense[],
  cards: Card[],
  now: Date,
): CardCommitment[] {
  const committedByCard = buildCommittedByCard(expenses, cards, now);

  return cards.flatMap((card) => {
    const limit = card.limit;
    if (limit == null || !(limit > 0)) return [];
    const committed = committedByCard.get(card.id) ?? 0;
    return [
      {
        id: card.id,
        name: card.name,
        expired: Boolean(card.expired),
        limit,
        committed,
        percent: (committed / limit) * 100,
      },
    ];
  });
}
