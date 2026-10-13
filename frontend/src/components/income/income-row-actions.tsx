import { Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { type IncomeStatus, salaryWaitLabel } from '@/lib/income-status';
import { cn } from '@/lib/utils';
import type { Income } from '@/types/finance';

export type ReceiptHandler = (
  income: Income,
  state: 'received' | 'waiting',
  month?: string,
) => void;

type IncomeRowActionsProps = {
  income: Income;
  status: IncomeStatus;
  receiptPending: boolean;
  deletePending: boolean;
  className?: string;
  onReceipt: ReceiptHandler;
  onEdit: () => void;
  onDelete: () => void;
};

function EditDeleteButtons({
  income,
  deletePending,
  onEdit,
  onDelete,
}: Pick<
  IncomeRowActionsProps,
  'income' | 'deletePending' | 'onEdit' | 'onDelete'
>) {
  return (
    <>
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label={`Editar ${income.name}`}
        onClick={onEdit}
      >
        <Pencil className='size-4' />
      </Button>
      <Button
        variant='ghost'
        size='icon-sm'
        aria-label={`Excluir ${income.name}`}
        disabled={deletePending}
        onClick={onDelete}
      >
        <Trash2 className='size-4' />
      </Button>
    </>
  );
}

/** Receipt / edit / delete controls shared by the table row and mobile card. */
export function IncomeRowActions({
  income,
  status,
  receiptPending,
  deletePending,
  className,
  onReceipt,
  onEdit,
  onDelete,
}: IncomeRowActionsProps) {
  const editButtons = (
    <EditDeleteButtons
      income={income}
      deletePending={deletePending}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );

  if (status.kind === 'profile') {
    return (
      <div className={cn('flex justify-end gap-1', className)}>
        <span className='text-xs text-muted-foreground'>Perfil</span>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap justify-end gap-1', className)}>
      {status.kind === 'salary' ? (
        <>
          {!status.salaryManual ? (
            <Button
              variant='secondary'
              size='sm'
              className='rounded-lg'
              disabled={receiptPending}
              onClick={() => onReceipt(income, 'received')}
            >
              Já recebi
            </Button>
          ) : null}
          {!status.salaryWaiting ? (
            <Button
              variant='ghost'
              size='sm'
              className='rounded-lg'
              disabled={receiptPending}
              onClick={() => onReceipt(income, 'waiting')}
            >
              {salaryWaitLabel(status)}
            </Button>
          ) : null}
        </>
      ) : null}

      {status.kind === 'one_off' ? (
        <Button
          variant={status.oneOffReceipt ? 'ghost' : 'secondary'}
          size='sm'
          className='rounded-lg'
          disabled={receiptPending}
          onClick={() =>
            status.oneOffReceipt
              ? onReceipt(income, 'waiting', status.oneOffReceipt.month)
              : onReceipt(income, 'received')
          }
        >
          {status.oneOffReceipt ? 'Desfazer recebimento' : 'Já recebi'}
        </Button>
      ) : null}

      {status.editable ? editButtons : null}
    </div>
  );
}
