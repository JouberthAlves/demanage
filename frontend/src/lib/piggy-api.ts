import { api } from '@/lib/api';
import type { PiggyBank, PiggyTransaction } from '@/types/finance';

export type PiggyBankPayload = {
  name: string;
  goalAmount: number | null;
  targetDate: string | null;
  monthlyGoal?: number | null;
  autoDebit?: boolean;
  autoDebitDay?: number;
  isEmergency?: boolean;
  yieldEnabled?: boolean;
  cdiPercent?: number;
};

export async function listPiggyBanks(includeArchived = false) {
  const { data } = await api.get<PiggyBank[]>('/piggy-banks', {
    params: includeArchived ? { includeArchived: true } : undefined,
  });
  return data;
}

export async function createPiggyBank(payload: PiggyBankPayload) {
  const { data } = await api.post<PiggyBank>('/piggy-banks', payload);
  return data;
}

export async function updatePiggyBank(
  id: string,
  payload: Partial<PiggyBankPayload>,
) {
  const { data } = await api.patch<PiggyBank>(`/piggy-banks/${id}`, payload);
  return data;
}

export async function deletePiggyBank(id: string) {
  await api.delete(`/piggy-banks/${id}`);
}

export async function depositPiggyBank(
  id: string,
  payload: { amount: number; note?: string },
) {
  const { data } = await api.post<{
    bank: PiggyBank;
    transaction: PiggyTransaction;
    completed: boolean;
    depositAmount: number;
  }>(`/piggy-banks/${id}/deposit`, payload);
  return data;
}

export async function withdrawPiggyBank(
  id: string,
  payload: { amount: number; note?: string },
) {
  const { data } = await api.post<{
    bank: PiggyBank;
    transaction: PiggyTransaction;
    isEmergency: boolean;
  }>(`/piggy-banks/${id}/withdraw`, payload);
  return data;
}

export async function archivePiggyBank(id: string) {
  const { data } = await api.post<PiggyBank>(`/piggy-banks/${id}/archive`);
  return data;
}

export async function listPiggyTransactions(id: string) {
  const { data } = await api.get<PiggyTransaction[]>(
    `/piggy-banks/${id}/transactions`,
  );
  return data;
}

export async function processPiggyAutoDebit() {
  const { data } = await api.post<{
    createdCount: number;
    interestCreatedCount: number;
    interestStale: boolean;
  }>('/piggy-banks/process-auto-debit');
  return data;
}
