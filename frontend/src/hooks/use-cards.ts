import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  type CardPayload,
  createCard,
  deleteCard,
  listCards,
  processCardBilling,
  updateCard,
} from '@/lib/cards-api';
import { invalidateDomain, queryKeys } from '@/lib/query-keys';
import type { Card } from '@/types/finance';

const NO_CARDS: Card[] = [];

// The QueryClient is session-scoped. Running billing maintenance for each
// useCards consumer can create overlapping writes to the same account.
const billingStartedForSession = new WeakSet<ReturnType<typeof useQueryClient>>();

export function useCards(enabled = true) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.cards,
    queryFn: listCards,
    enabled,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!enabled || !query.isSuccess || billingStartedForSession.has(queryClient)) return;
    billingStartedForSession.add(queryClient);

    processCardBilling()
      .then((billing) => {
        if (billing.createdCount > 0) {
          return invalidateDomain(queryClient, 'cards').then(() => undefined);
        }
        return queryClient.invalidateQueries({ queryKey: queryKeys.cards });
      })
      .catch(() => {
        // Allow a later mount to retry the maintenance run.
        billingStartedForSession.delete(queryClient);
        toast.error('Não foi possível atualizar as faturas agora.');
      });
  }, [enabled, query.isSuccess, queryClient]);

  return query;
}

/** Loaded cards, or a stable empty list while loading. */
export function useCardList() {
  return useCards().data ?? NO_CARDS;
}

function useCardMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateDomain(queryClient, 'cards'),
  });
}

export function useCreateCard() {
  return useCardMutation((payload: CardPayload) => createCard(payload));
}

export function useUpdateCard() {
  return useCardMutation(
    ({ id, payload }: { id: string; payload: Partial<CardPayload> }) =>
      updateCard(id, payload),
  );
}

export function useDeleteCard() {
  return useCardMutation((id: string) => deleteCard(id));
}
