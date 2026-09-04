import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  createExpense,
  deleteExpense,
  listExpenses,
  markExpensePaid,
  updateExpense,
  type ExpensePayload,
} from '@/lib/expenses-api';
import { useFinanceStore } from '@/stores/finance-store';

export const EXPENSES_QUERY_KEY = ['expenses'] as const;
const PATRIMONY_QUERY_KEY = ['patrimony'] as const;

function invalidateExpenseRelated(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: PATRIMONY_QUERY_KEY });
}

export function useExpenses() {
  const setExpenses = useFinanceStore((state) => state.setExpenses);

  const query = useQuery({
    queryKey: EXPENSES_QUERY_KEY,
    queryFn: listExpenses,
  });

  useEffect(() => {
    if (query.data) {
      setExpenses(query.data);
    }
  }, [query.data, setExpenses]);

  return query;
}

export function useCreateExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ExpensePayload) => createExpense(payload),
    onSuccess: () => invalidateExpenseRelated(queryClient),
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<ExpensePayload>;
    }) => updateExpense(id, payload),
    onSuccess: () => invalidateExpenseRelated(queryClient),
  });
}

export function useMarkExpensePaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, month }: { id: string; month: string }) =>
      markExpensePaid(id, month),
    onSuccess: () => invalidateExpenseRelated(queryClient),
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteExpense(id),
    onSuccess: () => invalidateExpenseRelated(queryClient),
  });
}
