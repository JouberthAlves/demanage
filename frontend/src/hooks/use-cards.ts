import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { EXPENSES_QUERY_KEY } from '@/hooks/use-expenses';
import {
  createCard,
  deleteCard,
  listCards,
  processCardBilling,
  updateCard,
  type CardPayload,
} from '@/lib/cards-api';
import { useFinanceStore } from '@/stores/finance-store';

export const CARDS_QUERY_KEY = ['cards'] as const;

export function useCards() {
  const setCards = useFinanceStore((state) => state.setCards);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: CARDS_QUERY_KEY,
    queryFn: async () => {
      const billing = await processCardBilling();
      if (billing.createdCount > 0) {
        void queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      }
      return listCards();
    },
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
      void queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
    },
  });
}
