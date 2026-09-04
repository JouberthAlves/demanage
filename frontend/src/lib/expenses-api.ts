import { api } from '@/lib/api';
import type {
  ExpenseCategory,
  ExpenseFrequency,
  ExpenseSplit,
  RecurringExpense,
} from '@/types/finance';

export type ApiExpenseSplit = {
  id?: string;
  kind: 'card' | 'pix';
  cardId: string | null;
  percent: number;
  amount: number;
  cardName?: string | null;
};

export type ApiExpense = {
  id: string;
  name: string;
  amount: string | number;
  category: ExpenseCategory;
  frequency: ExpenseFrequency;
  cardId: string | null;
  dueDay: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  occurredAt?: string | null;
  paidForMonth?: string | null;
  notes: string | null;
  isInvoice?: boolean;
  createdAt?: string;
  customTagId?: string | null;
  customTag?: {
    id: string;
    name: string;
    color: string;
  } | null;
  splits?: ApiExpenseSplit[];
};

export type ExpenseSplitPayload =
  | { kind: 'card'; cardId: string; percent: number }
  | { kind: 'pix'; percent: number };

export type ExpensePayload = {
  name: string;
  amount: number;
  category: ExpenseCategory;
  frequency?: ExpenseFrequency;
  cardId?: string | null;
  dueDay?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  notes?: string | null;
  customTagId?: string | null;
  splits?: ExpenseSplitPayload[] | null;
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

function mapSplits(splits?: ApiExpenseSplit[]): ExpenseSplit[] | undefined {
  if (!splits || splits.length === 0) return undefined;
  return splits.map((split) => ({
    id: split.id,
    kind: split.kind,
    cardId: split.cardId,
    percent: Number(split.percent),
    amount: Number(split.amount),
    cardName: split.cardName ?? null,
  }));
}

export function mapExpenseToLocal(expense: ApiExpense): RecurringExpense {
  const registeredAt = expense.occurredAt ?? expense.createdAt;
  return {
    id: expense.id,
    name: expense.name,
    amount: Number(expense.amount),
    category: expense.category,
    frequency: expense.frequency ?? 'mensal',
    cardId: expense.cardId ?? undefined,
    dueDay: expense.dueDay ?? undefined,
    startsAt: mapDateOnly(expense.startsAt),
    endsAt: mapDateOnly(expense.endsAt),
    registeredAt: registeredAt ? toLocalDateOnly(registeredAt) : undefined,
    paidForMonth: expense.paidForMonth ?? undefined,
    notes: expense.notes ?? undefined,
    isInvoice: Boolean(expense.isInvoice),
    customTagId: expense.customTagId ?? undefined,
    customTag: expense.customTag ?? undefined,
    splits: mapSplits(expense.splits),
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

export async function markExpensePaid(id: string, month: string) {
  const { data } = await api.post<ApiExpense>(`/expenses/${id}/pay`, { month });
  return mapExpenseToLocal(data);
}

export async function deleteExpense(id: string) {
  await api.delete(`/expenses/${id}`);
}
