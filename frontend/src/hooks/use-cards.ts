import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

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
  const maintenanceStarted = useRef(false);

  const query = useQuery({
    queryKey: CARDS_QUERY_KEY,
    queryFn: listCards,
  });

  useEffect(() => {
    if (query.data) {
      setCards(query.data);
    }
  }, [query.data, setCards]);

  useEffect(() => {
    if (!query.isSuccess || maintenanceStarted.current) return;
    maintenanceStarted.current = true;

    void processCardBilling()
      .then((billing) => {
        if (billing.createdCount > 0) {
          void queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
        }
        void queryClient.invalidateQueries({ queryKey: CARDS_QUERY_KEY });
      })
      .catch(() => {
        toast.error('Não foi possível atualizar as faturas agora.');
      });
  }, [query.isSuccess, queryClient]);

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
