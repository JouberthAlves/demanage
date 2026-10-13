import { StatusNote } from '@/components/shared/schedule-form/status-note';
import { Badge } from '@/components/ui/badge';
import { EXPENSE_FREQUENCY_LABELS } from '@/data/labels';
import { getCardTone } from '@/lib/card-tone';
import { expensePayState, expenseStatusNote } from '@/lib/expense-pay-state';
import { formatExpensePaymentLabel } from '@/lib/expense-splits';
import { formatCurrency } from '@/lib/format';
import { formatDayKeyBr } from '@/lib/schedule-labels';
import type { Card, RecurringExpense } from '@/types/finance';

import { ExpenseCategoryBadge } from './expense-category-badge';
import { expenseDiscountLabel } from './expense-labels';
import { ExpenseRowActions } from './expense-row-actions';

type ExpenseListCardProps = {
  expense: RecurringExpense;
  cards: Card[];
  now: Date;
  pending: boolean;
  onPay: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

/** Mobile representation of an expense row. */
export function ExpenseListCard({
  expense,
  cards,
  now,
  pending,
  onPay,
  onEdit,
  onDelete,
}: ExpenseListCardProps) {
  const primaryCard = cards.find((item) => item.id === expense.cardId);
  const tone = primaryCard ? getCardTone(primaryCard) : null;
  const paymentLabel = formatExpensePaymentLabel(expense, cards);
  const discountLabel = expenseDiscountLabel(expense);
  const showEndsAt =
    expense.frequency !== 'unica' && !expense.isInvoice && expense.endsAt;

  return (
    <article className='rounded-xl border border-border bg-black/20 p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 space-y-1'>
          <p className='truncate font-medium'>{expense.name}</p>
          <StatusNote note={expenseStatusNote(expense, now)} />
        </div>
        <p className='shrink-0 text-base font-semibold'>
          {formatCurrency(expense.amount)}
        </p>
      </div>

      <div className='mt-3 flex flex-wrap items-center gap-2'>
        <ExpenseCategoryBadge expense={expense} />
        <Badge variant='outline' className='text-muted-foreground'>
          {EXPENSE_FREQUENCY_LABELS[expense.frequency]}
        </Badge>
      </div>

      <div className='mt-3 space-y-1 text-xs text-muted-foreground'>
        {paymentLabel ? (
          <p className='inline-flex min-w-0 items-center gap-2 break-words [overflow-wrap:anywhere]'>
            {primaryCard && (expense.splits?.length ?? 0) <= 1 ? (
              <span
                className='size-2.5 shrink-0 rounded-sm'
                style={{ backgroundColor: tone?.fill }}
              />
            ) : null}
            {paymentLabel}
          </p>
        ) : null}
        {discountLabel ? <p>Desconto: {discountLabel}</p> : null}
        {showEndsAt ? <p>Término: {formatDayKeyBr(expense.endsAt)}</p> : null}
      </div>

      <ExpenseRowActions
        className='mt-4 flex-wrap'
        expense={expense}
        payState={expensePayState(expense, now, pending)}
        pending={pending}
        onPay={onPay}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </article>
  );
}
