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
