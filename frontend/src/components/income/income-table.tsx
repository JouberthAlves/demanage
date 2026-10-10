import { StatusNote } from '@/components/shared/schedule-form/status-note';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { INCOME_FREQUENCY_LABELS } from '@/data/labels';
import { formatCurrency } from '@/lib/format';
import { incomeStatus } from '@/lib/income-status';
import { formatDayKeyBr } from '@/lib/schedule-labels';
import type { Income } from '@/types/finance';

import { IncomeTypeBadge } from './income-category-badge';
import { incomeReceiveLabel } from './income-labels';
import { IncomeRowActions, type ReceiptHandler } from './income-row-actions';

type IncomeTableProps = {
  incomes: Income[];
  now: Date;
  receiptPending: boolean;
  deletePending: boolean;
  onReceipt: ReceiptHandler;
  onEdit: (income: Income) => void;
  onDelete: (income: Income) => void;
};

/** Desktop table of incomes. */
export function IncomeTable({
  incomes,
  now,
  receiptPending,
  deletePending,
  onReceipt,
  onEdit,
  onDelete,
}: IncomeTableProps) {
  return (
    <div className='hidden max-h-[70vh] overflow-auto rounded-xl border border-border bg-black/15 md:block'>
      <Table>
        <TableHeader className='sticky top-0 z-10 bg-card'>
          <TableRow className='hover:bg-transparent'>
            <TableHead>Nome</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Frequência</TableHead>
            <TableHead>Recebe / previsto</TableHead>
            <TableHead>Término</TableHead>
            <TableHead className='text-right'>Valor</TableHead>
            <TableHead className='w-64 text-right'>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {incomes.map((income) => {
            const status = incomeStatus(income, now);
            return (
              <TableRow key={income.id}>
                <TableCell className='font-medium'>
                  {income.name}
                  <StatusNote note={status.note} className='mt-0.5' />
                </TableCell>
                <TableCell>
                  <IncomeTypeBadge income={income} />
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {INCOME_FREQUENCY_LABELS[income.frequency]}
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {incomeReceiveLabel(income) ?? '—'}
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {income.type === 'salario'
                    ? '—'
                    : (formatDayKeyBr(income.endsAt) ?? '—')}
                </TableCell>
                <TableCell className='text-right font-semibold text-neon-green'>
                  {formatCurrency(income.amount)}
                </TableCell>
                <TableCell className='text-right'>
                  <IncomeRowActions
                    income={income}
                    status={status}
                    receiptPending={receiptPending}
                    deletePending={deletePending}
                    onReceipt={onReceipt}
                    onEdit={() => onEdit(income)}
                    onDelete={() => onDelete(income)}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
