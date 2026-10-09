import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
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

// The QueryClient is session-scoped. Running billing maintenance for each
// useCards consumer can create overlapping writes to the same account.
const billingStartedForSession = new WeakSet<ReturnType<typeof useQueryClient>>();

export function useCards(enabled = true) {
  const setCards = useFinanceStore((state) => state.setCards);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: CARDS_QUERY_KEY,
    queryFn: listCards,
    enabled,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.data) {
      setCards(query.data);
    }
  }, [query.data, setCards]);

  useEffect(() => {
    if (!enabled || !query.isSuccess || billingStartedForSession.has(queryClient)) return;
    billingStartedForSession.add(queryClient);

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
  }, [enabled, query.isSuccess, queryClient]);

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
