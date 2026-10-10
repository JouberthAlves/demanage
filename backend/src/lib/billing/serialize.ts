import type { Card } from '@/generated/prisma/client';

export function serializeCard(card: Card) {
  return {
    id: card.id,
    name: card.name,
    limit: card.limit == null ? null : Number(card.limit),
    closingDay: card.closingDay,
    pendingClosingDay: card.pendingClosingDay,
    archivedAt: card.archivedAt,
    expiresAt: card.expiresAt,
    lastInvoicedOn: card.lastInvoicedOn,
    lastBillingProcessedAt: card.lastBillingProcessedAt,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    expired: card.expiresAt ? card.expiresAt.getTime() < Date.now() : false,
  };
}
