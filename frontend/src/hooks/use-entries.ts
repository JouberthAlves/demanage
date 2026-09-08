import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  createEntry,
  deleteEntry,
  listEntries,
  setSalaryReceiptState,
  updateEntry,
  type EntryPayload,
  type SalaryReceiptState,
} from '@/lib/entries-api';
import { useFinanceStore } from '@/stores/finance-store';

export const ENTRIES_QUERY_KEY = ['entries'] as const;
const PATRIMONY_QUERY_KEY = ['patrimony'] as const;

function invalidateEntryRelated(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: PATRIMONY_QUERY_KEY });
}

export function useEntries() {
  const setIncomes = useFinanceStore((state) => state.setIncomes);

  const query = useQuery({
    queryKey: ENTRIES_QUERY_KEY,
    queryFn: listEntries,
  });

  useEffect(() => {
    if (query.data) {
      setIncomes(query.data);
    }
  }, [query.data, setIncomes]);

  return query;
}

export function useCreateEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: EntryPayload) => createEntry(payload),
    onSuccess: () => invalidateEntryRelated(queryClient),
  });
}

export function useUpdateEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<EntryPayload>;
    }) => updateEntry(id, payload),
    onSuccess: () => invalidateEntryRelated(queryClient),
  });
}

export function useSalaryReceiptState() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      month,
      state,
    }: {
      id: string;
      month: string;
      state: SalaryReceiptState;
    }) => setSalaryReceiptState(id, month, state),
    onSuccess: () => invalidateEntryRelated(queryClient),
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteEntry(id),
    onSuccess: () => invalidateEntryRelated(queryClient),
  });
}
