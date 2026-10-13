import { CustomTagSelect } from '@/components/shared/schedule-form/custom-tag-select';
import { FrequencySelect } from '@/components/shared/schedule-form/frequency-select';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { EXPENSE_FREQUENCY_LABELS } from '@/data/labels';
import { expenseCategoryOptions } from '@/lib/expense-form';
import type { RecurringExpense } from '@/types/finance';

import {
  ExpenseAmountField,
  ExpenseNameField,
  ExpenseNotesField,
} from './expense-basic-fields';
import { ExpensePaymentFields } from './expense-payment-fields';
import {
  ExpenseOneOffDate,
  ExpenseScheduleFields,
} from './expense-schedule-fields';
import { useExpenseForm } from './use-expense-form';

type ExpenseFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: RecurringExpense | null;
};

type ExpenseFormBodyProps = {
  expense: RecurringExpense | null;
  onClose: () => void;
};

// Mounted fresh every time the dialog content opens (Radix unmounts closed
// content), so the form state is initialised from props, not reset by effects.
function ExpenseFormBody({ expense, onClose }: ExpenseFormBodyProps) {
  const f = useExpenseForm({ expense, onDone: onClose });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{expense ? 'Editar despesa' : 'Nova despesa'}</DialogTitle>
        <DialogDescription>
          Cadastre assinaturas, parcelas e outras despesas.
        </DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void f.submit();
        }}
        className='flex min-w-0 flex-col gap-4'
      >
        <ExpenseNameField f={f} />
        <ExpenseAmountField f={f} />

        <div className='grid grid-cols-2 gap-3'>
          <CustomTagSelect
            id='expense-category'
            label='Categoria'
            scope='expense'
            value={f.form.categoryKey}
            options={expenseCategoryOptions(f.form.categoryKey)}
            onChange={(categoryKey) => f.patch({ categoryKey })}
          />
          <FrequencySelect
            id='expense-frequency'
            value={f.form.frequency}
            labels={EXPENSE_FREQUENCY_LABELS}
            onChange={f.setFrequency}
          />
        </div>

        <ExpenseScheduleFields f={f} />
        <ExpenseOneOffDate f={f} />
        <ExpensePaymentFields f={f} />
        <ExpenseNotesField f={f} />

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            className='rounded-lg'
            onClick={onClose}
            disabled={f.submitting}
          >
            Cancelar
          </Button>
          <Button
            type='submit'
            className='rounded-lg'
            disabled={f.submitting || f.limitBlocked}
          >
            {f.submitting ? <Spinner data-icon='inline-start' /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
}: ExpenseFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[min(90dvh,720px)] overflow-x-hidden overflow-y-auto rounded-xl sm:max-w-md'>
        <ExpenseFormBody
          key={expense?.id ?? 'new'}
          expense={expense}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
