import { useMemo } from 'react';

import { useCards } from '@/hooks/use-cards';
import type { Card } from '@/types/finance';

const NO_CARDS: Card[] = [];

/** Cartões do usuário com o limite total e o comprometido (vindo do backend). */
export function useCardsOverview() {
  const cardsQuery = useCards();
  const cards = cardsQuery.data ?? NO_CARDS;

  const totalLimit = useMemo(
    () => cards.reduce((sum, card) => sum + (card.limit ?? 0), 0),
    [cards],
  );

  const totalCommitted = useMemo(
    () => cards.reduce((sum, card) => sum + card.committed, 0),
    [cards],
  );

  return {
    cards,
    totalLimit,
    totalCommitted,
    isLoading: cardsQuery.isLoading,
    isError: cardsQuery.isError,
  };
}
