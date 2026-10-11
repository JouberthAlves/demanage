import { StatusNote } from '@/components/shared/schedule-form/status-note';
import { Badge } from '@/components/ui/badge';
import { INCOME_FREQUENCY_LABELS } from '@/data/labels';
import { formatCurrency } from '@/lib/format';
import { incomeStatus } from '@/lib/income-status';
import { formatDayKeyBr } from '@/lib/schedule-labels';
import type { Income } from '@/types/finance';

import { IncomeTypeBadge } from './income-category-badge';
import { incomeReceiveLabel } from './income-labels';
import { IncomeRowActions, type ReceiptHandler } from './income-row-actions';

type IncomeListCardProps = {
  income: Income;
  now: Date;
  receiptPending: boolean;
  deletePending: boolean;
  onReceipt: ReceiptHandler;
  onEdit: () => void;
  onDelete: () => void;
};

/** Mobile representation of an income row. */
export function IncomeListCard({
  income,
  now,
  receiptPending,
  deletePending,
  onReceipt,
  onEdit,
  onDelete,
}: IncomeListCardProps) {
  const status = incomeStatus(income, now);
  const receiveLabel = incomeReceiveLabel(income);

  return (
    <article className='rounded-xl border border-border bg-black/20 p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 space-y-1'>
          <p className='truncate font-medium'>{income.name}</p>
          <StatusNote note={status.note} />
        </div>
        <p className='shrink-0 text-base font-semibold text-neon-green'>
          {formatCurrency(income.amount)}
        </p>
      </div>

      <div className='mt-3 flex flex-wrap items-center gap-2'>
        <IncomeTypeBadge income={income} />
        <Badge variant='outline' className='text-muted-foreground'>
          {INCOME_FREQUENCY_LABELS[income.frequency]}
        </Badge>
      </div>

      <div className='mt-3 space-y-1 text-xs text-muted-foreground'>
        {receiveLabel ? (
          <p>
            {income.frequency === 'unica' ? 'Previsto:' : 'Recebe:'}{' '}
            {receiveLabel}
          </p>
        ) : null}
        {income.type !== 'salario' && income.endsAt ? (
          <p>Término: {formatDayKeyBr(income.endsAt)}</p>
        ) : null}
      </div>

      <IncomeRowActions
        className='mt-4'
        income={income}
        status={status}
        receiptPending={receiptPending}
        deletePending={deletePending}
        onReceipt={onReceipt}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </article>
  );
}
