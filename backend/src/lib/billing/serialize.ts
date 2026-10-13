import type { Card } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import { maxChargesForWindow } from '@/lib/billing/charges';
import { currentCycleWindow } from '@/lib/billing/cycle-window';
import { todayKeyInSaoPaulo } from '@/lib/civil-date';
import { toMoney } from '@/lib/money';

/**
 * `committed` is what getCommittedByCard computed for this card (the single
 * source of truth for "used limit"); `available` = limit - committed, in cents,
 * or null for a card without a limit. Archived cards commit nothing.
 */
export function serializeCard(card: Card, committedAmount = 0) {
  const committed = card.archivedAt ? 0 : toMoney(committedAmount).toNumber();
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
    committed,
    available:
      card.limit == null
        ? null
        : toMoney(new Prisma.Decimal(card.limit).minus(committed)).toNumber(),
    /** Worst-case charges per frequency in this card's current open cycle. */
    maxChargesPerCycle: maxChargesForWindow(
      currentCycleWindow(card, todayKeyInSaoPaulo()),
    ),
    expired: card.expiresAt ? card.expiresAt.getTime() < Date.now() : false,
  };
}
