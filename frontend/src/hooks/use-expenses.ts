import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createExpense,
  deleteExpense,
  type ExpensePayload,
  listExpenses,
  markExpensePaid,
  updateExpense,
} from '@/lib/expenses-api';
import { invalidateDomain, queryKeys } from '@/lib/query-keys';
import type { RecurringExpense } from '@/types/finance';

const NO_EXPENSES: RecurringExpense[] = [];

export function useExpenses(enabled = true) {
  return useQuery({
    queryKey: queryKeys.expenses,
    queryFn: listExpenses,
    enabled,
    staleTime: 60_000,
  });
}

/** Loaded expenses, or a stable empty list while loading. */
export function useExpenseList() {
  return useExpenses().data ?? NO_EXPENSES;
}

function useExpenseMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateDomain(queryClient, 'expenses'),
  });
}

export function useCreateExpense() {
  return useExpenseMutation((payload: ExpensePayload) =>
    createExpense(payload),
  );
}

export function useUpdateExpense() {
  return useExpenseMutation(
    ({ id, payload }: { id: string; payload: Partial<ExpensePayload> }) =>
      updateExpense(id, payload),
  );
}

export function useMarkExpensePaid() {
  return useExpenseMutation(({ id, month }: { id: string; month: string }) =>
    markExpensePaid(id, month),
  );
}

export function useDeleteExpense() {
  return useExpenseMutation((id: string) => deleteExpense(id));
}
