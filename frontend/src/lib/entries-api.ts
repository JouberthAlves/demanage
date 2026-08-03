import { api } from '@/lib/api';
import type { Income, IncomeFrequency, IncomeType } from '@/types/finance';

export type ApiEntry = {
  id: string;
  name: string;
  amount: string | number;
  type: IncomeType;
  frequency: IncomeFrequency;
  date: string | null;
};

export type EntryPayload = {
  name: string;
  amount: number;
  type: IncomeType;
  frequency: IncomeFrequency;
  date?: string | null;
};

export function mapEntryToIncome(entry: ApiEntry): Income {
  return {
    id: entry.id,
    name: entry.name,
    amount: Number(entry.amount),
    type: entry.type,
    frequency: entry.frequency,
    date: entry.date ? entry.date.slice(0, 10) : undefined,
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
