import {
  dayValueFromStored,
  type FormFieldError,
  isRecurringFrequency,
  monthValueFromStartsAt,
  resolveSchedule,
  scheduleValuesForFrequency,
  validateSchedule,
} from '@/components/shared/schedule-form/validate-schedule';
import { BUILTIN_INCOME_TYPE_LABELS, INCOME_TYPE_LABELS } from '@/data/labels';
import { parseDayKey, todayKey } from '@/lib/dates';
import type { EntryPayload } from '@/lib/entries-api';
import { formatBrlInputValue, parseCurrencyInput } from '@/lib/format';
import type { Income, IncomeFrequency, IncomeType } from '@/types/finance';

export type IncomeFormState = {
  name: string;
  amount: string;
  /** Built-in type, or `tag:<id>` for a custom tag. */
  typeKey: string;
  frequency: IncomeFrequency;
  receiveDay: string;
  receiveMonth: string;
  endsAt: string;
  /** Expected date of a one-off income (YYYY-MM-DD). */
  date: string;
};

export const INCOME_FIELD_IDS = {
  error: 'income-form-error',
  name: 'income-name',
  amount: 'income-amount',
  schedule: {
    day: 'income-receive-day',
    month: 'income-receive-month',
    endsAt: 'income-ends-at',
  },
  date: 'income-date',
} as const;

const SCHEDULE_MESSAGES = {
  day: 'Informe o dia em que recebe (01-31)',
  month: 'Informe o mês em que recebe',
  endsAt: 'Data de término deve ser após o primeiro recebimento',
};

/** Defaults for a new income, built when the dialog opens. */
export function emptyIncomeForm(now: Date): IncomeFormState {
  return {
    name: '',
    amount: '',
    typeKey: 'freelance',
    frequency: 'mensal',
    receiveDay: '05',
    receiveMonth: monthValueFromStartsAt(null, now),
    endsAt: '',
    date: todayKey(now),
  };
}

export function formFromIncome(income: Income, now: Date): IncomeFormState {
  return {
    name: income.name,
    amount: formatBrlInputValue(income.amount),
    typeKey: income.customTagId ? `tag:${income.customTagId}` : income.type,
    frequency: income.frequency,
    receiveDay: dayValueFromStored(income.receiveDay),
    receiveMonth: monthValueFromStartsAt(income.startsAt, now),
    endsAt: income.endsAt ?? '',
    date: income.date ?? todayKey(now),
  };
}

/**
 * Type options for the select. Creation is limited to the built-in types, but
 * the current value is always listed so editing an "outro" income shows it.
 */
export function incomeTypeOptions(currentKey: string) {
  const options = Object.entries(BUILTIN_INCOME_TYPE_LABELS).map(
    ([value, label]) => ({ value, label }),
  );
  if (
    currentKey in INCOME_TYPE_LABELS &&
    !(currentKey in BUILTIN_INCOME_TYPE_LABELS)
  ) {
    options.push({
      value: currentKey,
      label: INCOME_TYPE_LABELS[currentKey as IncomeType],
    });
  }
  return options;
}

export function applyIncomeFrequency(
  form: IncomeFormState,
  frequency: IncomeFrequency,
  now: Date,
): IncomeFormState {
  const schedule = scheduleValuesForFrequency(
    { day: form.receiveDay, month: form.receiveMonth, endsAt: form.endsAt },
    frequency,
    now,
  );
  return {
    ...form,
    frequency,
    receiveDay: schedule.day,
    receiveMonth: schedule.month,
    endsAt: schedule.endsAt,
    date:
      frequency === 'unica' ? form.date || todayKey(now) : form.date,
  };
}

/** Returns the first problem found, or null when the form can be saved. */
export function validateIncomeForm(
  form: IncomeFormState,
  context: { now: Date; previousStartsAt?: string | null },
): FormFieldError | null {
  if (!form.name.trim()) {
    return { fieldId: INCOME_FIELD_IDS.name, message: 'Informe o nome da entrada' };
  }
  if (parseCurrencyInput(form.amount) <= 0) {
    return { fieldId: INCOME_FIELD_IDS.amount, message: 'Informe um valor válido' };
  }

  if (isRecurringFrequency(form.frequency)) {
    const schedule = validateSchedule(
      { day: form.receiveDay, month: form.receiveMonth, endsAt: form.endsAt },
      INCOME_FIELD_IDS.schedule,
      SCHEDULE_MESSAGES,
      context,
    );
    if (!schedule.ok) return schedule.error;
  }

  if (form.frequency === 'unica' && !parseDayKey(form.date)) {
    return { fieldId: INCOME_FIELD_IDS.date, message: 'Informe a data da entrada' };
  }
  return null;
}

/** API payload for a form that already passed validateIncomeForm. */
export function buildIncomePayload(
  form: IncomeFormState,
  context: { now: Date; previousStartsAt?: string | null },
): EntryPayload {
  const isCustom = form.typeKey.startsWith('tag:');
  const recurring = isRecurringFrequency(form.frequency);
  const schedule = recurring
    ? resolveSchedule({ day: form.receiveDay, month: form.receiveMonth }, context)
    : null;

  return {
    name: form.name.trim().slice(0, 100),
    amount: parseCurrencyInput(form.amount),
    type: isCustom ? 'outro' : (form.typeKey as IncomeType),
    frequency: form.frequency,
    receiveDay: schedule?.day ?? null,
    startsAt: schedule?.startsAt ?? null,
    endsAt: recurring ? form.endsAt || null : null,
    date: form.frequency === 'unica' ? form.date || null : null,
    customTagId: isCustom ? form.typeKey.slice(4) : null,
  };
}
