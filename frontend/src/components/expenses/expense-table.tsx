import { StatusNote } from '@/components/shared/schedule-form/status-note';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

type ExpenseTableProps = {
  expenses: RecurringExpense[];
  cards: Card[];
  now: Date;
  pending: boolean;
  onPay: (expense: RecurringExpense) => void;
  onEdit: (expense: RecurringExpense) => void;
  onDelete: (expense: RecurringExpense) => void;
};

function PaymentCell({
  expense,
  cards,
}: {
  expense: RecurringExpense;
  cards: Card[];
}) {
  const label = formatExpensePaymentLabel(expense, cards);
  if (!label) return <span className='text-muted-foreground'>—</span>;

  const card = cards.find((item) => item.id === expense.cardId);
  const showDot = card && (expense.splits?.length ?? 0) <= 1;
  return (
    <span className='inline-flex max-w-52 items-center gap-2 text-muted-foreground'>
      {showDot ? (
        <span
          className='size-2.5 shrink-0 rounded-sm'
          style={{ backgroundColor: getCardTone(card).fill }}
        />
      ) : null}
      <span className='min-w-0 break-words [overflow-wrap:anywhere]'>
        {label}
      </span>
    </span>
  );
}

/** Desktop table of expenses. */
export function ExpenseTable({
  expenses,
  cards,
  now,
  pending,
  onPay,
  onEdit,
  onDelete,
}: ExpenseTableProps) {
  return (
    <div className='hidden max-h-[70vh] overflow-auto rounded-xl border border-border bg-black/15 md:block'>
      <Table>
        <TableHeader className='sticky top-0 z-10 bg-card'>
          <TableRow className='hover:bg-transparent'>
            <TableHead>Nome</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead>Frequência</TableHead>
            <TableHead>Cartão</TableHead>
            <TableHead>Desconto</TableHead>
            <TableHead>Término</TableHead>
            <TableHead className='text-right'>Valor</TableHead>
            <TableHead className='w-40 text-right'>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {expenses.map((expense) => {
            const showEndsAt =
              expense.frequency !== 'unica' && !expense.isInvoice;
            return (
              <TableRow key={expense.id}>
                <TableCell className='font-medium'>
                  {expense.name}
                  <StatusNote
                    note={expenseStatusNote(expense, now)}
                    className='mt-0.5'
                  />
                </TableCell>
                <TableCell>
                  <ExpenseCategoryBadge expense={expense} />
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {EXPENSE_FREQUENCY_LABELS[expense.frequency]}
                </TableCell>
                <TableCell>
                  <PaymentCell expense={expense} cards={cards} />
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {expenseDiscountLabel(expense) ?? '—'}
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {showEndsAt ? (formatDayKeyBr(expense.endsAt) ?? '—') : '—'}
                </TableCell>
                <TableCell className='text-right font-semibold'>
                  {formatCurrency(expense.amount)}
                </TableCell>
                <TableCell className='text-right'>
                  <ExpenseRowActions
                    expense={expense}
                    payState={expensePayState(expense, now, pending)}
                    pending={pending}
                    onPay={() => onPay(expense)}
                    onEdit={() => onEdit(expense)}
                    onDelete={() => onDelete(expense)}
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
