import { api } from '@/lib/api';
import type { ExpenseCategory, RecurringExpense } from '@/types/finance';

export type ApiExpense = {
  id: string;
  name: string;
  amount: string | number;
  category: ExpenseCategory;
  frequency: 'mensal';
  cardId: string | null;
  dueDay: number | null;
  notes: string | null;
};

export type ExpensePayload = {
  name: string;
  amount: number;
  category: ExpenseCategory;
  frequency?: 'mensal';
  cardId?: string | null;
  dueDay?: number | null;
  notes?: string | null;
};

export function mapExpenseToLocal(expense: ApiExpense): RecurringExpense {
  return {
    id: expense.id,
    name: expense.name,
    amount: Number(expense.amount),
    category: expense.category,
    frequency: expense.frequency ?? 'mensal',
    cardId: expense.cardId ?? undefined,
    dueDay: expense.dueDay ?? undefined,
    notes: expense.notes ?? undefined,
  };
}

export async function listExpenses() {
  const { data } = await api.get<ApiExpense[]>('/expenses');
  return data.map(mapExpenseToLocal);
}

export async function createExpense(payload: ExpensePayload) {
  const { data } = await api.post<ApiExpense>('/expenses', payload);
  return mapExpenseToLocal(data);
}

export async function updateExpense(
  id: string,
  payload: Partial<ExpensePayload>,
) {
  const { data } = await api.patch<ApiExpense>(`/expenses/${id}`, payload);
  return mapExpenseToLocal(data);
}

export async function deleteExpense(id: string) {
  await api.delete(`/expenses/${id}`);
}
