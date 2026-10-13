import { api } from '@/lib/api';
import { dayKeyOf } from '@/lib/dates';
import type {
  ExpenseCategory,
  ExpenseFrequency,
  ExpensePaymentOccurrence,
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
  date?: string;
  occurredAt?: string | null;
  billingPeriodStart?: string | null;
  billingPeriodEnd?: string | null;
  paidForMonth?: string | null;
  paidAt?: string | null;
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
  payments?: Array<{
    month: string;
    amount: string | number;
    paidAt: string;
  }>;
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
  date?: string;
  notes?: string | null;
  customTagId?: string | null;
  splits?: ExpenseSplitPayload[] | null;
};

function mapDateOnly(value?: string | null) {
  return value ? value.slice(0, 10) : undefined;
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
    occurredAt: expense.occurredAt ?? undefined,
    billingPeriodStart: mapDateOnly(expense.billingPeriodStart),
    billingPeriodEnd: mapDateOnly(expense.billingPeriodEnd),
    registeredAt: registeredAt ? (dayKeyOf(registeredAt) ?? undefined) : undefined,
    paidForMonth: expense.paidForMonth ?? undefined,
    paidAt: expense.paidAt ?? undefined,
    createdAt: expense.createdAt,
    notes: expense.notes ?? undefined,
    isInvoice: Boolean(expense.isInvoice),
    customTagId: expense.customTagId ?? undefined,
    customTag: expense.customTag ?? undefined,
    splits: mapSplits(expense.splits),
    payments: expense.payments?.map((payment): ExpensePaymentOccurrence => ({
      month: payment.month,
      amount: Number(payment.amount),
      paidAt: payment.paidAt,
    })),
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
