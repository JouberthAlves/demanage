import { api } from '@/lib/api';
import { isCardExpired } from '@/lib/format';
import type { Card } from '@/types/finance';

export type ApiCard = {
  id: string;
  name: string;
  limit: string | number | null;
  closingDay: number | null;
  expiresAt: string | null;
  lastInvoicedOn: string | null;
  expired?: boolean;
};

export type CardPayload = {
  name: string;
  limit?: number | null;
  closingDay?: number | null;
  expiresAt?: string | null;
};

export function mapCardToLocal(card: ApiCard): Card {
  const expiresAt = card.expiresAt ?? undefined;
  return {
    id: card.id,
    name: card.name,
    limit: card.limit == null ? undefined : Number(card.limit),
    closingDay: card.closingDay ?? undefined,
    expiresAt,
    lastInvoicedOn: card.lastInvoicedOn ?? undefined,
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
