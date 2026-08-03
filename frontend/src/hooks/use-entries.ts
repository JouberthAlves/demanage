import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  createEntry,
  deleteEntry,
  listEntries,
  updateEntry,
  type EntryPayload,
} from '@/lib/entries-api';
import { useFinanceStore } from '@/stores/finance-store';

export const ENTRIES_QUERY_KEY = ['entries'] as const;

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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY });
    },
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY });
    },
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteEntry(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY });
    },
  });
}
