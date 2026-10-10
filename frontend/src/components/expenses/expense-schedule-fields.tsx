import { FieldError } from '@/components/shared/schedule-form/field-error';
import { fieldErrorProps } from '@/components/shared/schedule-form/field-error-props';
import { ScheduleFields } from '@/components/shared/schedule-form/schedule-fields';
import { DatePicker } from '@/components/ui/date-picker';
import { Label } from '@/components/ui/label';
import { todayKey } from '@/lib/dates';
import { EXPENSE_FIELD_IDS } from '@/lib/expense-form';

import type { ExpenseFormApi } from './use-expense-form';

const { error: ERROR_ID, occurredAt: OCCURRED_ID } = EXPENSE_FIELD_IDS;

/** Day / month / end date for monthly and weekly expenses. */
export function ExpenseScheduleFields({ f }: { f: ExpenseFormApi }) {
  const { form } = f;
  if (form.frequency === 'unica') return null;

  return (
    <ScheduleFields
      ids={EXPENSE_FIELD_IDS.schedule}
      errorId={ERROR_ID}
      heading='Quando será descontado'
      firstLabel='Primeiro desconto'
      frequency={form.frequency}
      values={{ day: form.dueDay, month: form.dueMonth, endsAt: form.endsAt }}
      onChange={(changes) =>
        f.patch({
          ...(changes.day !== undefined && { dueDay: changes.day }),
          ...(changes.month !== undefined && { dueMonth: changes.month }),
          ...(changes.endsAt !== undefined && { endsAt: changes.endsAt }),
        })
      }
      error={f.error}
      now={f.now}
      previousStartsAt={f.previousStartsAt}
    />
  );
}

/** Date picker for one-off expenses. */
export function ExpenseOneOffDate({ f }: { f: ExpenseFormApi }) {
  if (!f.isUnique) return null;
  const props = fieldErrorProps(f.error, OCCURRED_ID, ERROR_ID);

  return (
    <>
      <div className='flex flex-col gap-2'>
        <Label htmlFor={OCCURRED_ID}>Data da despesa</Label>
        <DatePicker
          id={OCCURRED_ID}
          value={f.form.occurredAt}
          onValueChange={(occurredAt) => f.patch({ occurredAt })}
          max={todayKey(f.now)}
          ariaInvalid={props['aria-invalid']}
          ariaDescribedBy={props['aria-describedby']}
        />
        <FieldError error={f.error} fieldId={OCCURRED_ID} errorId={ERROR_ID} />
        <p className='text-xs text-muted-foreground'>
          Use o dia em que o gasto aconteceu.
        </p>
      </div>
      <p className='text-xs text-muted-foreground'>
        Despesa única usa a data de hoje e não tem vencimento.
      </p>
    </>
  );
}
