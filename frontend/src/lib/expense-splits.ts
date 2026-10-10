import { dayKeyOf, todayKey } from '@/lib/dates';
import type { Card, RecurringExpense } from '@/types/finance';

export function expenseCashAmount(expense: RecurringExpense) {
  if (expense.isInvoice) return expense.amount;

  const splits = expense.splits ?? [];
  if (splits.length > 0) {
    return splits
      .filter((split) => split.kind === 'pix')
      .reduce((sum, split) => sum + split.amount, 0);
  }

  if (expense.cardId) return 0;
  return expense.amount;
}

export function expenseCardCommittedAmount(
  expense: RecurringExpense,
  cardId: string,
) {
  if (expense.isInvoice) return 0;

  const splits = expense.splits ?? [];
  if (splits.length > 0) {
    return splits
      .filter((split) => split.kind === 'card' && split.cardId === cardId)
      .reduce((sum, split) => sum + split.amount, 0);
  }

  if (expense.cardId === cardId) return expense.amount;
  return 0;
}

export function buildCommittedByCard(
  expenses: RecurringExpense[],
  cards: Card[],
  now = new Date(),
) {
  const map = new Map<string, number>();
  const through = todayKey(now);

  for (const card of cards) {
    const periodStart = card.lastInvoicedOn
      ? card.lastInvoicedOn.slice(0, 10)
      : card.createdAt
        ? (dayKeyOf(card.createdAt) ?? through)
        : through;
    const hasClosedPeriod = Boolean(card.lastInvoicedOn);
    const processedAt = card.lastBillingProcessedAt
      ? Date.parse(card.lastBillingProcessedAt)
      : Number.NaN;

    for (const expense of expenses) {
      if (expense.isInvoice) continue;
      const committed = expenseCardCommittedAmount(expense, card.id);
      if (committed <= 0) continue;

      if (expense.frequency === 'unica') {
        const occurred =
          expense.registeredAt ??
          (expense.createdAt
            ? dayKeyOf(expense.createdAt)
            : null);
        if (
          occurred &&
          occurred <= through &&
          (hasClosedPeriod ? occurred > periodStart : occurred >= periodStart)
        ) {
          map.set(card.id, (map.get(card.id) ?? 0) + committed);
        } else if (
          hasClosedPeriod &&
          Number.isFinite(processedAt) &&
          expense.createdAt &&
          Date.parse(expense.createdAt) > processedAt &&
          occurred &&
          occurred <= periodStart
        ) {
          map.set(card.id, (map.get(card.id) ?? 0) + committed);
        }
        continue;
      }

      if (expense.startsAt && expense.startsAt.slice(0, 10) > through) continue;
      if (expense.endsAt && expense.endsAt.slice(0, 10) < through) continue;
      const multiplier = expense.frequency === 'semanal' ? 4 : 1;
      map.set(
        card.id,
        (map.get(card.id) ?? 0) + committed * multiplier,
      );
    }
  }
  return map;
}

export function availableCardLimit(args: {
  limit?: number | null;
  committed: number;
  extraReserved?: number;
}) {
  if (args.limit == null) return null;
  return Math.max(
    0,
    Math.round(
      (args.limit - args.committed - (args.extraReserved ?? 0)) * 100,
    ) / 100,
  );
}

export function formatExpensePaymentLabel(
  expense: RecurringExpense,
  cards: Array<{ id: string; name: string }>,
) {
  const splits = expense.splits ?? [];
  if (splits.length > 0) {
    return splits
      .map((split) => {
        const percent = Math.round(split.percent);
        if (split.kind === 'pix') return `PIX ${percent}%`;
        const name =
          split.cardName ??
          cards.find((card) => card.id === split.cardId)?.name ??
          'Cartão';
        return `${name} ${percent}%`;
      })
      .join(' · ');
  }

  if (expense.cardId) {
    return cards.find((card) => card.id === expense.cardId)?.name ?? 'Cartão';
  }

  return null;
}
