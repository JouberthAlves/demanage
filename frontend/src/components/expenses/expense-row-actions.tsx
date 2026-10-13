import { Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ExpensePayState } from '@/lib/expense-pay-state';
import { cn } from '@/lib/utils';
import type { RecurringExpense } from '@/types/finance';

type ExpenseRowActionsProps = {
  expense: RecurringExpense;
  payState: ExpensePayState;
  pending: boolean;
  className?: string;
  onPay: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

/** Pay / edit / delete buttons shared by the table row and the mobile card. */
export function ExpenseRowActions({
  expense,
  payState,
  pending,
  className,
  onPay,
  onEdit,
  onDelete,
}: ExpenseRowActionsProps) {
  return (
    <div className={cn('flex justify-end gap-1', className)}>
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
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={`Editar ${expense.name}`}
          onClick={onEdit}
        >
          <Pencil className='size-4' />
        </Button>
      ) : null}
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label={`Excluir ${expense.name}`}
        disabled={pending}
        onClick={onDelete}
      >
        <Trash2 className='size-4' />
      </Button>
    </div>
  );
}
