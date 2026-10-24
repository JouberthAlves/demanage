import { api } from '@/lib/api';
import type { Income, IncomeFrequency, IncomeType } from '@/types/finance';

export type ApiEntry = {
  id: string;
  archivedAt?: string | null;
  name: string;
  notes?: string | null;
  amount: string | number;
  type: IncomeType;
  frequency: IncomeFrequency;
  receiveDay?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  date: string | null;
  receiptHoldForMonth?: string | null;
  receivedForMonth?: string | null;
  receivedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  customTagId?: string | null;
  customTag?: {
    id: string;
    name: string;
    color: string;
  } | null;
  receipts?: Array<{
    id?: string;
    month: string;
    amount: string | number;
    receivedAt: string;
  }>;
};

export type EntryPayload = {
  name: string;
  notes?: string | null;
  amount: number;
  type: IncomeType;
  frequency: IncomeFrequency;
  receiveDay?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  date?: string | null;
  customTagId?: string | null;
};

export type EntryReceiptState = 'automatic' | 'received' | 'waiting';

function mapDateOnly(value?: string | null) {
  if (!value) return undefined;
  return value.slice(0, 10);
}

export function mapEntryToIncome(entry: ApiEntry): Income {
  return {
    id: entry.id,
    archivedAt: entry.archivedAt ?? null,
    name: entry.name,
    notes: entry.notes ?? null,
    amount: Number(entry.amount),
    type: entry.type,
    frequency: entry.frequency,
    receiveDay: entry.receiveDay ?? undefined,
    startsAt: mapDateOnly(entry.startsAt),
    endsAt: mapDateOnly(entry.endsAt),
    date: mapDateOnly(entry.date),
    receiptHoldForMonth: entry.receiptHoldForMonth ?? undefined,
    receivedForMonth: entry.receivedForMonth ?? undefined,
    receivedAt: entry.receivedAt ?? undefined,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    customTagId: entry.customTagId ?? undefined,
    customTag: entry.customTag ?? undefined,
    receipts: entry.receipts?.map((receipt) => ({
      id: receipt.id,
      month: receipt.month,
      amount: Number(receipt.amount),
      receivedAt: receipt.receivedAt,
    })),
  };
}

export async function listEntries() {
  const { data } = await api.get<ApiEntry[]>('/entries');
  return data.map(mapEntryToIncome);
}

export async function createEntry(payload: EntryPayload) {
  const { data } = await api.post<ApiEntry>('/entries', payload);
  return mapEntryToIncome(data);
}

export async function updateEntry(id: string, payload: Partial<EntryPayload>) {
  const { data } = await api.patch<ApiEntry>(`/entries/${id}`, payload);
  return mapEntryToIncome(data);
}

export async function setEntryReceiptState(
  id: string,
  month: string,
  state: EntryReceiptState,
  options: { receivedOn?: string; expectedUpdatedAt?: string } = {},
) {
  const { data } = await api.post<ApiEntry>(`/entries/${id}/receipt-state`, {
    month,
    state,
    ...options,
  });
  return mapEntryToIncome(data);
}

export async function deleteEntry(id: string) {
  await api.delete(`/entries/${id}`);
}
