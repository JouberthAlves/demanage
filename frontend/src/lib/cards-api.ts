import { api } from '@/lib/api';
import type { Card } from '@/types/finance';

export type ApiCard = {
  id: string;
  name: string;
  limit: string | number | null;
  closingDay: number | null;
  dueDay: number | null;
};

export type CardPayload = {
  name: string;
  limit?: number | null;
  closingDay?: number | null;
  dueDay?: number | null;
};

export function mapCardToLocal(card: ApiCard): Card {
  return {
    id: card.id,
    name: card.name,
    limit: card.limit == null ? undefined : Number(card.limit),
    closingDay: card.closingDay ?? undefined,
    dueDay: card.dueDay ?? undefined,
  };
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
