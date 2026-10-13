import type { Card } from '@/types/finance';

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
 * Per-card limit usage for cards with a limit. `committed` is computed by the
 * backend for the current billing cycle; nothing is recomputed here.
 */
export function selectCardCommitments(cards: Card[]): CardCommitment[] {
  return cards.flatMap((card) => {
    const limit = card.limit;
    if (limit == null || !(limit > 0)) return [];
    const committed = card.committed;
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
