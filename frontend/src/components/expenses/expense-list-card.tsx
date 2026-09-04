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
import {
  canPayExpenseEarly,
  isExpenseAutoDebitedThisMonth,
  isExpensePaidThisMonth,
} from '@/lib/expense-schedule';
import {
  expenseCashAmount,
  formatExpensePaymentLabel,
} from '@/lib/expense-splits';
import { formatCurrency } from '@/lib/format';
import type { Card, ExpenseCategory, RecurringExpense } from '@/types/finance';

const categoryColors: Record<ExpenseCategory, string> = {
  assinatura: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  parcela: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  divida: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  outro: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  cofrinho: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  investimento: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

type ExpenseListCardProps = {
  expense: RecurringExpense;
  cards: Card[];
  pending?: boolean;
  onPay: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function ExpenseListCard({
  expense,
  cards,
  pending,
  onPay,
  onEdit,
  onDelete,
}: ExpenseListCardProps) {
  const primaryCard = cards.find((item) => item.id === expense.cardId);
  const tone = primaryCard ? getCardTone(primaryCard) : null;
  const paymentLabel = formatExpensePaymentLabel(expense, cards);
  const hasCash = expenseCashAmount(expense) > 0;
  const paidEarly = isExpensePaidThisMonth(expense);
  const autoDebited = hasCash && isExpenseAutoDebitedThisMonth(expense);
  const canPayEarly = canPayExpenseEarly(expense);
  const isRecurring = expense.frequency !== 'unica' && !expense.isInvoice;

  const payState = (() => {
    if (!isRecurring) return { label: 'Pago', disabled: Boolean(pending) };
    if (!hasCash) return { label: 'Via fatura', disabled: true };
    if (paidEarly) return { label: 'Pago', disabled: true };
    if (autoDebited) return { label: 'Descontada', disabled: true };
    if (canPayEarly) {
      return { label: 'Pagar agora', disabled: Boolean(pending) };
    }
    return { label: 'Aguardando', disabled: true };
  })();

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
          {isRecurring && hasCash ? (
            paidEarly ? (
              <p className='text-xs text-neon-green'>Pago antecipadamente</p>
            ) : autoDebited ? (
              <p className='text-xs text-neon-green'>
                Descontada automaticamente
              </p>
            ) : (
              <p className='text-xs text-muted-foreground'>
                Aguardando dia {expense.dueDay ?? '—'}
              </p>
            )
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
          disabled={payState.disabled}
          onClick={onPay}
        >
          {payState.label}
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
