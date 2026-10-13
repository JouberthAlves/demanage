import { api } from '@/lib/api';
import { isCardExpired } from '@/lib/format';
import { fromCents, toCents } from '@/lib/money';
import type { Card, ExpenseFrequency } from '@/types/finance';

export type ApiCard = {
  id: string;
  name: string;
  limit: string | number | null;
  closingDay: number | null;
  pendingClosingDay?: number | null;
  expiresAt: string | null;
  lastInvoicedOn: string | null;
  lastBillingProcessedAt?: string | null;
  createdAt: string;
  expired?: boolean;
  /** Absent on older backends. */
  committed?: string | number | null;
  available?: string | number | null;
  /** Absent on older backends: falls back to a normal cycle. */
  maxChargesPerCycle?: Partial<Record<ExpenseFrequency, number>> | null;
};

export type CardPayload = {
  name: string;
  limit?: number | null;
  closingDay?: number | null;
  expiresAt?: string | null;
};

export function mapCardToLocal(card: ApiCard): Card {
  const expiresAt = card.expiresAt ?? undefined;
  const limit = card.limit == null ? undefined : Number(card.limit);
  const committed = card.committed == null ? 0 : Number(card.committed);
  // Older backends do not send `available`: derive it from limit - committed.
  const available =
    limit == null
      ? null
      : card.available == null
        ? fromCents(toCents(limit) - toCents(committed))
        : Number(card.available);
  return {
    id: card.id,
    name: card.name,
    limit,
    committed,
    available,
    maxChargesPerCycle: {
      unica: card.maxChargesPerCycle?.unica ?? 1,
      mensal: card.maxChargesPerCycle?.mensal ?? 1,
      semanal: card.maxChargesPerCycle?.semanal ?? 5,
    },
    closingDay: card.closingDay ?? undefined,
    pendingClosingDay: card.pendingClosingDay ?? null,
    expiresAt,
    lastInvoicedOn: card.lastInvoicedOn ?? undefined,
    lastBillingProcessedAt: card.lastBillingProcessedAt,
    createdAt: card.createdAt,
    expired: card.expired ?? isCardExpired(expiresAt),
  };
}

export async function processCardBilling() {
  const { data } = await api.post<{ createdCount: number }>(
    '/cards/process-billing',
  );
  return data;
}

export async function listCards() {
  const { data } = await api.get<ApiCard[]>('/cards');
  return data.map(mapCardToLocal);
}

export async function createCard(payload: CardPayload) {
  const { data } = await api.post<ApiCard>('/cards', payload);
  return mapCardToLocal(data);
}

export async function updateCard(id: string, payload: Partial<CardPayload>) {
  const { data } = await api.patch<ApiCard>(`/cards/${id}`, payload);
  return mapCardToLocal(data);
}

export async function deleteCard(id: string) {
  await api.delete(`/cards/${id}`);
}
