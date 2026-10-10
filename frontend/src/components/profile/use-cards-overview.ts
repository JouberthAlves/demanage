import { useMemo } from 'react';

import { useCards } from '@/hooks/use-cards';
import { useExpenseList } from '@/hooks/use-expenses';
import { buildCommittedByCard } from '@/lib/expense-splits';
import type { Card } from '@/types/finance';

const NO_CARDS: Card[] = [];

/** Cartões do usuário com o limite total e o comprometimento por cartão. */
export function useCardsOverview() {
  const cardsQuery = useCards();
  const expenses = useExpenseList();
  const cards = cardsQuery.data ?? NO_CARDS;

  const committedByCard = useMemo(
    () => buildCommittedByCard(expenses, cards),
    [expenses, cards],
  );

  const totalLimit = useMemo(
    () => cards.reduce((sum, card) => sum + (card.limit ?? 0), 0),
    [cards],
  );

  const totalCommitted = useMemo(
    () =>
      cards.reduce((sum, card) => sum + (committedByCard.get(card.id) ?? 0), 0),
    [cards, committedByCard],
  );

  return {
    cards,
    committedByCard,
    totalLimit,
    totalCommitted,
    isLoading: cardsQuery.isLoading,
    isError: cardsQuery.isError,
  };
}
