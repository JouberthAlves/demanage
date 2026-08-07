import type { RecurringExpense } from '@/types/finance';

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

export function buildCommittedByCard(expenses: RecurringExpense[]) {
  const map = new Map<string, number>();
  for (const expense of expenses) {
    if (expense.isInvoice) continue;

    const splits = expense.splits ?? [];
    if (splits.length > 0) {
      for (const split of splits) {
        if (split.kind !== 'card' || !split.cardId) continue;
        map.set(
          split.cardId,
          (map.get(split.cardId) ?? 0) + split.amount,
        );
      }
      continue;
    }
    if (!expense.cardId) continue;
    map.set(
      expense.cardId,
      (map.get(expense.cardId) ?? 0) + expense.amount,
    );
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
