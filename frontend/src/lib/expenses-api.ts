import { api } from '@/lib/api';
import type {
  ExpenseCategory,
  ExpenseFrequency,
  RecurringExpense,
} from '@/types/finance';

export type ApiExpense = {
  id: string;
  name: string;
  amount: string | number;
  category: ExpenseCategory;
  frequency: ExpenseFrequency;
  cardId: string | null;
  dueDay: number | null;
  endsAt?: string | null;
  notes: string | null;
  isInvoice?: boolean;
  createdAt?: string;
  customTagId?: string | null;
  customTag?: {
    id: string;
    name: string;
    color: string;
  } | null;
};

export type ExpensePayload = {
  name: string;
  amount: number;
  category: ExpenseCategory;
  frequency?: ExpenseFrequency;
  cardId?: string | null;
  dueDay?: number | null;
  endsAt?: string | null;
  notes?: string | null;
  customTagId?: string | null;
};

function toLocalDateOnly(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function mapDateOnly(value?: string | null) {
  if (!value) return undefined;
  return value.slice(0, 10);
}

export function mapExpenseToLocal(expense: ApiExpense): RecurringExpense {
  return {
    id: expense.id,
    name: expense.name,
    amount: Number(expense.amount),
    category: expense.category,
    frequency: expense.frequency ?? 'mensal',
    cardId: expense.cardId ?? undefined,
    dueDay: expense.dueDay ?? undefined,
    endsAt: mapDateOnly(expense.endsAt),
    registeredAt: expense.createdAt
      ? toLocalDateOnly(expense.createdAt)
      : undefined,
    notes: expense.notes ?? undefined,
    isInvoice: Boolean(expense.isInvoice),
    customTagId: expense.customTagId ?? undefined,
    customTag: expense.customTag ?? undefined,
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
