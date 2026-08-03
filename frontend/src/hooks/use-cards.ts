import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  createCard,
  deleteCard,
  listCards,
  updateCard,
  type CardPayload,
} from '@/lib/cards-api';
import { useFinanceStore } from '@/stores/finance-store';

export const CARDS_QUERY_KEY = ['cards'] as const;

export function useCards() {
  const setCards = useFinanceStore((state) => state.setCards);

  const query = useQuery({
    queryKey: CARDS_QUERY_KEY,
    queryFn: listCards,
  });

  useEffect(() => {
    if (query.data) {
      setCards(query.data);
    }
  }, [query.data, setCards]);

  return query;
}

export function useCreateCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CardPayload) => createCard(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
    },
  });
}

export function useUpdateCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<CardPayload>;
    }) => updateCard(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
    },
  });
}

export function useDeleteCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteCard(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
  });
}
