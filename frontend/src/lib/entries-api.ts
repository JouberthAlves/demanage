import { api } from '@/lib/api';
import type { Income, IncomeFrequency, IncomeType } from '@/types/finance';

export type ApiEntry = {
  id: string;
  name: string;
  amount: string | number;
  type: IncomeType;
  frequency: IncomeFrequency;
  receiveDay?: number | null;
  endsAt?: string | null;
  date: string | null;
  customTagId?: string | null;
  customTag?: {
    id: string;
    name: string;
    color: string;
  } | null;
};

export type EntryPayload = {
  name: string;
  amount: number;
  type: IncomeType;
  frequency: IncomeFrequency;
  receiveDay?: number | null;
  endsAt?: string | null;
  date?: string | null;
  customTagId?: string | null;
};

function mapDateOnly(value?: string | null) {
  if (!value) return undefined;
  return value.slice(0, 10);
}

export function mapEntryToIncome(entry: ApiEntry): Income {
  return {
    id: entry.id,
    name: entry.name,
    amount: Number(entry.amount),
    type: entry.type,
    frequency: entry.frequency,
    receiveDay: entry.receiveDay ?? undefined,
    endsAt: mapDateOnly(entry.endsAt),
    date: mapDateOnly(entry.date),
    customTagId: entry.customTagId ?? undefined,
    customTag: entry.customTag ?? undefined,
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

export async function deleteEntry(id: string) {
  await api.delete(`/entries/${id}`);
}
