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
import { runDailyMaintenance } from '@/lib/daily-maintenance';
import { invalidateDomain, queryKeys } from '@/lib/query-keys';
import { useCalendarStore } from '@/stores/calendar-store';
import type { Card } from '@/types/finance';

const NO_CARDS: Card[] = [];

export function useCards(enabled = true) {
  const queryClient = useQueryClient();
  const dayKey = useCalendarStore((state) => state.dayKey);

  const query = useQuery({
    queryKey: queryKeys.cards,
    queryFn: listCards,
    enabled,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!enabled || !query.isSuccess) return;
    runDailyMaintenance(queryClient, 'cards', dayKey, {
      run: processCardBilling,
      needsRetry: () => false,
      onResult: (billing) => {
        if (billing.createdCount > 0) {
          return invalidateDomain(queryClient, 'cards');
        }
        return queryClient.invalidateQueries({ queryKey: queryKeys.cards });
      },
      onError: () => {
        toast.error('Não foi possível atualizar as faturas agora.');
      },
    });
  }, [enabled, query.isSuccess, queryClient, dayKey]);

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
