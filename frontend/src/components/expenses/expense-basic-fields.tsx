import { FieldError } from '@/components/shared/schedule-form/field-error';
import { fieldErrorProps } from '@/components/shared/schedule-form/field-error-props';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EXPENSE_FIELD_IDS } from '@/lib/expense-form';

import type { ExpenseFormApi } from './use-expense-form';

const { name: NAME_ID, amount: AMOUNT_ID, error: ERROR_ID } = EXPENSE_FIELD_IDS;

export function ExpenseNameField({ f }: { f: ExpenseFormApi }) {
  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <Label htmlFor={NAME_ID}>Nome</Label>
      <Input
        id={NAME_ID}
        {...fieldErrorProps(f.error, NAME_ID, ERROR_ID)}
        value={f.form.name}
        onChange={(event) => f.patch({ name: event.target.value })}
        placeholder='Ex: Netflix'
        maxLength={100}
        className='min-w-0 rounded-lg'
      />
      <FieldError error={f.error} fieldId={NAME_ID} errorId={ERROR_ID} />
    </div>
  );
}

export function ExpenseAmountField({ f }: { f: ExpenseFormApi }) {
  return (
    <div className='flex flex-col gap-2'>
      <Label htmlFor={AMOUNT_ID}>Valor</Label>
      <CurrencyInput
        id={AMOUNT_ID}
        {...fieldErrorProps(f.error, AMOUNT_ID, ERROR_ID)}
        value={f.form.amount}
        onValueChange={(amount) => f.patch({ amount })}
        className='rounded-lg'
      />
      <FieldError error={f.error} fieldId={AMOUNT_ID} errorId={ERROR_ID} />
    </div>
  );
}

export function ExpenseNotesField({ f }: { f: ExpenseFormApi }) {
  return (
    <div className='flex min-w-0 flex-col gap-2'>
      <Label htmlFor='expense-notes'>Observações</Label>
      <Textarea
        id='expense-notes'
        value={f.form.notes}
        onChange={(event) => f.patch({ notes: event.target.value })}
        placeholder='Opcional'
        maxLength={500}
        className='max-h-40 min-h-20 field-sizing-fixed overflow-y-auto rounded-lg'
      />
      <p className='text-xs text-muted-foreground'>{f.form.notes.length}/500</p>
    </div>
  );
}
