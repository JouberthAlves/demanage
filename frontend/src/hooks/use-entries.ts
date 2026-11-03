import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createEntry,
  deleteEntry,
  type EntryPayload,
  type EntryReceiptState,
  listEntries,
  setEntryReceiptState,
  updateEntry,
} from '@/lib/entries-api';
import { invalidateDomain, queryKeys } from '@/lib/query-keys';
import type { Income } from '@/types/finance';

const NO_INCOMES: Income[] = [];

export function useEntries(enabled = true) {
  return useQuery({
    queryKey: queryKeys.entries,
    queryFn: listEntries,
    enabled,
    staleTime: 60_000,
  });
}

/** Loaded incomes, or a stable empty list while loading. */
export function useIncomeList() {
  return useEntries().data ?? NO_INCOMES;
}

function useEntryMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => { void invalidateDomain(queryClient, 'entries'); },
  });
}

export function useCreateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: EntryPayload) => createEntry(payload),
    onSuccess: (created) => {
      queryClient.setQueryData<Income[]>(queryKeys.entries, (old) =>
        old ? [created, ...old.filter((entry) => entry.id !== created.id)] : old,
      );
      void invalidateDomain(queryClient, 'entries');
    },
  });
}

export function useUpdateEntry() {
  return useEntryMutation(
    ({ id, payload }: { id: string; payload: Partial<EntryPayload> }) =>
      updateEntry(id, payload),
  );
}

export function useEntryReceiptState() {
  return useEntryMutation(
    ({
      id,
      month,
      state,
      receivedOn,
      expectedUpdatedAt,
    }: {
      id: string;
      month: string;
      state: EntryReceiptState;
      receivedOn?: string;
      expectedUpdatedAt?: string;
    }) =>
      setEntryReceiptState(id, month, state, { receivedOn, expectedUpdatedAt }),
  );
}

export function useDeleteEntry() {
  return useEntryMutation((id: string) => deleteEntry(id));
}
