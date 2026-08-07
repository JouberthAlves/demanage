import { Pencil, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  EXPENSE_FREQUENCY_LABELS,
  MONTH_LABELS,
  expenseTypeLabel,
  tagBadgeStyle,
} from '@/data/labels';
import { getCardTone } from '@/lib/card-tone';
import { isExpenseDebitedThisMonth } from '@/lib/expense-schedule';
import { formatCurrency } from '@/lib/format';
import type { Card, ExpenseCategory, RecurringExpense } from '@/types/finance';

const categoryColors: Record<ExpenseCategory, string> = {
  assinatura: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  parcela: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  divida: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  outro: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  cofrinho: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
};

type ExpenseListCardProps = {
  expense: RecurringExpense;
  card?: Card;
  pending?: boolean;
  onPay: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function ExpenseListCard({
  expense,
  card,
  pending,
  onPay,
  onEdit,
  onDelete,
}: ExpenseListCardProps) {
  const tone = card ? getCardTone(card) : null;
  const debited = isExpenseDebitedThisMonth(expense);

  const discountLabel =
    expense.frequency === 'unica'
      ? expense.registeredAt
        ? expense.registeredAt.split('-').reverse().join('/')
        : 'Hoje'
      : expense.dueDay
        ? `Dia ${String(expense.dueDay).padStart(2, '0')}${
            expense.startsAt
              ? ` · ${MONTH_LABELS[Number(expense.startsAt.slice(5, 7))] ?? ''}`
              : ''
          }`
        : null;

  return (
    <article className='rounded-xl border border-border bg-black/20 p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 space-y-1'>
          <p className='truncate font-medium'>{expense.name}</p>
          {expense.frequency !== 'unica' &&
          !expense.isInvoice &&
          !debited ? (
            <p className='text-xs text-muted-foreground'>
              Aguardando dia {expense.dueDay ?? '—'}
            </p>
          ) : null}
        </div>
        <p className='shrink-0 text-base font-semibold'>
          {formatCurrency(expense.amount)}
        </p>
      </div>

      <div className='mt-3 flex flex-wrap items-center gap-2'>
        {expense.customTag ? (
          <Badge
            variant='outline'
            style={tagBadgeStyle(expense.customTag.color)}
          >
            {expense.customTag.name}
          </Badge>
        ) : (
          <Badge
            variant='outline'
            className={categoryColors[expense.category]}
          >
            {expenseTypeLabel(expense)}
          </Badge>
        )}
        <Badge variant='outline' className='text-muted-foreground'>
          {EXPENSE_FREQUENCY_LABELS[expense.frequency]}
        </Badge>
      </div>

      <div className='mt-3 space-y-1 text-xs text-muted-foreground'>
        {card ? (
          <p className='inline-flex items-center gap-2'>
            <span
              className='size-2.5 rounded-sm'
              style={{ backgroundColor: tone?.fill }}
            />
            {card.name}
          </p>
        ) : null}
        {discountLabel ? <p>Desconto: {discountLabel}</p> : null}
        {expense.frequency !== 'unica' &&
        !expense.isInvoice &&
        expense.endsAt ? (
          <p>Término: {expense.endsAt.split('-').reverse().join('/')}</p>
        ) : null}
      </div>

      <div className='mt-4 flex flex-wrap justify-end gap-1'>
        <Button
          variant='secondary'
          size='sm'
          className='rounded-lg'
          disabled={pending}
          onClick={onPay}
        >
          Pago
        </Button>
        {!expense.isInvoice ? (
          <Button variant='ghost' size='icon-sm' onClick={onEdit}>
            <Pencil className='size-4' />
          </Button>
        ) : null}
        <Button
          variant='ghost'
          size='icon-sm'
          disabled={pending}
          onClick={onDelete}
        >
          <Trash2 className='size-4' />
        </Button>
      </div>
    </article>
  );
}

export { categoryColors };
