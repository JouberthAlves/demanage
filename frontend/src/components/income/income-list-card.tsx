import { Pencil, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  INCOME_FREQUENCY_LABELS,
  MONTH_LABELS,
  incomeTypeLabel,
  tagBadgeStyle,
} from '@/data/labels';
import { formatCurrency } from '@/lib/format';
import {
  isIncomeAutoReceivedThisMonth,
  isIncomeReceivedThisMonth,
  isSalaryManuallyReceived,
  isSalaryWaitingForConfirmation,
} from '@/lib/income-schedule';
import type { Income, IncomeType } from '@/types/finance';

const typeColors: Record<IncomeType, string> = {
  salario: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  freelance: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  outro: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
};

type IncomeListCardProps = {
  income: Income;
  pending?: boolean;
  salaryPending?: boolean;
  onSalaryReceived?: () => void;
  onSalaryWait?: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function IncomeListCard({
  income,
  pending,
  salaryPending,
  onSalaryReceived,
  onSalaryWait,
  onEdit,
  onDelete,
}: IncomeListCardProps) {
  const received = isIncomeReceivedThisMonth(income);
  const salaryMonthly = income.type === 'salario' && income.frequency === 'mensal';
  const salaryWaiting = isSalaryWaitingForConfirmation(income);
  const salaryManual = isSalaryManuallyReceived(income);
  const salaryAutomatic = salaryMonthly && isIncomeAutoReceivedThisMonth(income);

  const receiveLabel =
    income.frequency === 'unica'
      ? income.date
        ? income.date.split('-').reverse().join('/')
        : null
      : income.receiveDay
        ? `Dia ${String(income.receiveDay).padStart(2, '0')}${
            income.startsAt
              ? ` · ${MONTH_LABELS[Number(income.startsAt.slice(5, 7))] ?? ''}`
              : ''
          }`
        : null;

  const salaryStatus = (() => {
    if (!salaryMonthly) return null;
    if (salaryWaiting) {
      return (
        <p className='text-xs text-neon-amber'>
          Aguardando confirmação manual
        </p>
      );
    }
    if (salaryManual) {
      return <p className='text-xs text-neon-green'>Recebimento confirmado</p>;
    }
    if (salaryAutomatic) {
      return <p className='text-xs text-neon-green'>Recebido automaticamente</p>;
    }
    return (
      <p className='text-xs text-muted-foreground'>
        Aguardando dia {income.receiveDay ?? '—'}
      </p>
    );
  })();

  return (
    <article className='rounded-xl border border-border bg-black/20 p-4'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 space-y-1'>
          <p className='truncate font-medium'>{income.name}</p>
          {salaryStatus ??
            (income.frequency !== 'unica' && !received ? (
              <p className='text-xs text-muted-foreground'>
                Aguardando dia {income.receiveDay ?? '—'}
              </p>
            ) : null)}
        </div>
        <p className='shrink-0 text-base font-semibold text-neon-green'>
          {formatCurrency(income.amount)}
        </p>
      </div>

      <div className='mt-3 flex flex-wrap items-center gap-2'>
        {income.customTag ? (
          <Badge
            variant='outline'
            style={tagBadgeStyle(income.customTag.color)}
          >
            {income.customTag.name}
          </Badge>
        ) : (
          <Badge variant='outline' className={typeColors[income.type]}>
            {incomeTypeLabel(income)}
          </Badge>
        )}
        <Badge variant='outline' className='text-muted-foreground'>
          {INCOME_FREQUENCY_LABELS[income.frequency]}
        </Badge>
      </div>

      <div className='mt-3 space-y-1 text-xs text-muted-foreground'>
        {receiveLabel ? <p>Recebe: {receiveLabel}</p> : null}
        {income.type !== 'salario' && income.endsAt ? (
          <p>Término: {income.endsAt.split('-').reverse().join('/')}</p>
        ) : null}
      </div>

      <div className='mt-4 flex flex-wrap justify-end gap-1'>
        {salaryMonthly ? (
          <>
            {!salaryManual ? (
              <Button
                variant='secondary'
                size='sm'
                className='rounded-lg'
                disabled={salaryPending}
                onClick={onSalaryReceived}
              >
                Já recebi
              </Button>
            ) : null}
            {!salaryWaiting ? (
              <Button
                variant='ghost'
                size='sm'
                className='rounded-lg'
                disabled={salaryPending}
                onClick={onSalaryWait}
              >
                {salaryAutomatic || salaryManual
                  ? 'Ainda não recebi'
                  : 'Aguardar confirmação'}
              </Button>
            ) : null}
          </>
        ) : income.type === 'salario' ? (
          <span className='text-xs text-muted-foreground'>Perfil</span>
        ) : (
          <>
            <Button variant='ghost' size='icon-sm' onClick={onEdit}>
              <Pencil className='size-4' />
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              disabled={pending}
              onClick={onDelete}
            >
              <Trash2 className='size-4' />
            </Button>
          </>
        )}
      </div>
    </article>
  );
}

export { typeColors };
