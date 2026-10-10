import { CustomTagSelect } from '@/components/shared/schedule-form/custom-tag-select';
import { FieldError } from '@/components/shared/schedule-form/field-error';
import { fieldErrorProps } from '@/components/shared/schedule-form/field-error-props';
import { FrequencySelect } from '@/components/shared/schedule-form/frequency-select';
import { ScheduleFields } from '@/components/shared/schedule-form/schedule-fields';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { INCOME_FREQUENCY_LABELS } from '@/data/labels';
import { INCOME_FIELD_IDS, incomeTypeOptions } from '@/lib/income-form';
import type { Income } from '@/types/finance';

import { type IncomeFormApi, useIncomeForm } from './use-income-form';

const {
  error: ERROR_ID,
  name: NAME_ID,
  amount: AMOUNT_ID,
  date: DATE_ID,
} = INCOME_FIELD_IDS;

type IncomeFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  income: Income | null;
};

function IncomeOneOffDate({ f }: { f: IncomeFormApi }) {
  const props = fieldErrorProps(f.error, DATE_ID, ERROR_ID);
  return (
    <div className='flex flex-col gap-2'>
      <Label htmlFor={DATE_ID}>Data prevista</Label>
      <DatePicker
        id={DATE_ID}
        value={f.form.date}
        onValueChange={(date) => f.patch({ date })}
        placeholder='Selecione a data'
        allowClear
        ariaInvalid={props['aria-invalid']}
        ariaDescribedBy={props['aria-describedby']}
      />
      <FieldError error={f.error} fieldId={DATE_ID} errorId={ERROR_ID} />
      <p className='text-xs text-muted-foreground'>
        Depois que o valor entrar, confirme &quot;Já recebi&quot; para
        incluí-lo no histórico.
      </p>
    </div>
  );
}

// Mounted fresh every time the dialog content opens (Radix unmounts closed
// content), so the form state is initialised from props, not reset by effects.
function IncomeFormBody({
  income,
  onClose,
}: {
  income: Income | null;
  onClose: () => void;
}) {
  const f = useIncomeForm({ income, onDone: onClose });
  const { form } = f;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{income ? 'Editar entrada' : 'Nova entrada'}</DialogTitle>
        <DialogDescription>
          Cadastre fontes de renda mensais, semanais ou únicas.
        </DialogDescription>
      </DialogHeader>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void f.submit();
        }}
        className='flex flex-col gap-4'
      >
        <div className='flex flex-col gap-2'>
          <Label htmlFor={NAME_ID}>Nome</Label>
          <Input
            id={NAME_ID}
            {...fieldErrorProps(f.error, NAME_ID, ERROR_ID)}
            value={form.name}
            onChange={(event) => f.patch({ name: event.target.value })}
            placeholder='Ex: Freelance'
            maxLength={100}
            className='rounded-lg'
          />
          <FieldError error={f.error} fieldId={NAME_ID} errorId={ERROR_ID} />
        </div>

        <div className='flex flex-col gap-2'>
          <Label htmlFor={AMOUNT_ID}>Valor</Label>
          <CurrencyInput
            id={AMOUNT_ID}
            {...fieldErrorProps(f.error, AMOUNT_ID, ERROR_ID)}
            value={form.amount}
            onValueChange={(amount) => f.patch({ amount })}
            className='rounded-lg'
          />
          <FieldError error={f.error} fieldId={AMOUNT_ID} errorId={ERROR_ID} />
        </div>

        <div className='grid grid-cols-2 gap-3'>
          <CustomTagSelect
            id='income-type'
            label='Tipo'
            scope='income'
            value={form.typeKey}
            options={incomeTypeOptions(form.typeKey)}
            onChange={(typeKey) => f.patch({ typeKey })}
          />
          <FrequencySelect
            id='income-frequency'
            value={form.frequency}
            labels={INCOME_FREQUENCY_LABELS}
            onChange={f.setFrequency}
          />
        </div>

        {form.frequency === 'unica' ? (
          <IncomeOneOffDate f={f} />
        ) : (
          <ScheduleFields
            ids={INCOME_FIELD_IDS.schedule}
            errorId={ERROR_ID}
            heading='Quando recebe'
            firstLabel='Primeiro recebimento'
            frequency={form.frequency}
            values={{
              day: form.receiveDay,
              month: form.receiveMonth,
              endsAt: form.endsAt,
            }}
            onChange={(changes) =>
              f.patch({
                ...(changes.day !== undefined && { receiveDay: changes.day }),
                ...(changes.month !== undefined && {
                  receiveMonth: changes.month,
                }),
                ...(changes.endsAt !== undefined && { endsAt: changes.endsAt }),
              })
            }
            error={f.error}
            now={f.now}
            previousStartsAt={f.previousStartsAt}
          />
        )}

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
          <Button type='submit' className='rounded-lg' disabled={f.submitting}>
            {f.submitting ? <Spinner data-icon='inline-start' /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function IncomeFormDialog({
  open,
  onOpenChange,
  income,
}: IncomeFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[min(90dvh,720px)] overflow-y-auto rounded-xl sm:max-w-md'>
        <IncomeFormBody
          key={income?.id ?? 'new'}
          income={income}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
