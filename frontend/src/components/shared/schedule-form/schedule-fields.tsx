import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MONTH_OPTIONS } from '@/data/labels';
import { maskClosingDayInput, normalizeClosingDayInput } from '@/lib/format';

import { FieldError } from './field-error';
import { fieldErrorProps } from './field-error-props';
import {
  type FormFieldError,
  type ScheduleFieldValues,
  type ScheduleIds,
  schedulePreview,
} from './validate-schedule';

type ScheduleFieldsProps = {
  ids: ScheduleIds;
  errorId: string;
  /** "Quando será descontado" / "Quando recebe" */
  heading: string;
  /** "Primeiro desconto" / "Primeiro recebimento" */
  firstLabel: string;
  frequency: 'mensal' | 'semanal';
  values: ScheduleFieldValues;
  onChange: (patch: Partial<ScheduleFieldValues>) => void;
  error: FormFieldError | null;
  now: Date;
  /** startsAt of the item being edited, so the preview matches what is saved. */
  previousStartsAt?: string | null;
};

/** Day / month of the first occurrence plus the optional end date. */
export function ScheduleFields({
  ids,
  errorId,
  heading,
  firstLabel,
  frequency,
  values,
  onChange,
  error,
  now,
  previousStartsAt,
}: ScheduleFieldsProps) {
  const preview = schedulePreview(values, { now, previousStartsAt });
  const endsAtProps = fieldErrorProps(error, ids.endsAt, errorId);

  return (
    <>
      <div className='flex flex-col gap-2'>
        <p className='text-sm font-medium'>{heading}</p>
        <div className='grid grid-cols-2 gap-3'>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor={ids.day} className='text-xs text-muted-foreground'>
              Dia
            </Label>
            <Input
              id={ids.day}
              {...fieldErrorProps(error, ids.day, errorId)}
              inputMode='numeric'
              maxLength={2}
              value={values.day}
              onChange={(event) =>
                onChange({ day: maskClosingDayInput(event.target.value) })
              }
              onBlur={() =>
                onChange({ day: normalizeClosingDayInput(values.day) })
              }
              placeholder='05'
              className='rounded-lg'
            />
            <FieldError error={error} fieldId={ids.day} errorId={errorId} />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label
              id={`${ids.month}-label`}
              htmlFor={ids.month}
              className='text-xs text-muted-foreground'
            >
              Mês
            </Label>
            <Select
              value={values.month}
              onValueChange={(month) => {
                if (month) onChange({ month });
              }}
            >
              <SelectTrigger
                id={ids.month}
                aria-labelledby={`${ids.month}-label`}
                {...fieldErrorProps(error, ids.month, errorId)}
                className='rounded-lg'
              >
                <SelectValue placeholder='Mês' />
              </SelectTrigger>
              <SelectContent>
                {MONTH_OPTIONS.map((month) => (
                  <SelectItem key={month.value} value={String(month.value)}>
                    {month.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError error={error} fieldId={ids.month} errorId={errorId} />
          </div>
        </div>
        {preview ? (
          <p className='text-xs text-muted-foreground'>
            {firstLabel} em <span className='text-foreground'>{preview}</span>
            {frequency === 'semanal'
              ? ' · semanal equivale a ~4× no mês.'
              : ', depois repete todo mês.'}
          </p>
        ) : (
          <p className='text-xs text-muted-foreground'>
            Escolha o dia e o mês do {firstLabel.toLowerCase()}.
          </p>
        )}
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor={ids.endsAt}>Data de término</Label>
        <DatePicker
          id={ids.endsAt}
          value={values.endsAt}
          onValueChange={(endsAt) => onChange({ endsAt })}
          placeholder='Sem data de término'
          allowClear
          ariaInvalid={endsAtProps['aria-invalid']}
          ariaDescribedBy={endsAtProps['aria-describedby']}
        />
        <FieldError error={error} fieldId={ids.endsAt} errorId={errorId} />
        <p className='text-xs text-muted-foreground'>
          Opcional. Vazio = sem fim.
        </p>
      </div>
    </>
  );
}
