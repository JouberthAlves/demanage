import { useState } from 'react';
import { toast } from 'sonner';

import type { FormFieldError } from '@/components/shared/schedule-form/validate-schedule';
import { useCreateEntry, useUpdateEntry } from '@/hooks/use-entries';
import { useFinancialNow } from '@/hooks/use-financial-now';
import { getApiErrorMessage } from '@/lib/api-error';
import {
  applyIncomeFrequency,
  buildIncomePayload,
  emptyIncomeForm,
  formFromIncome,
  type IncomeFormState,
  validateIncomeForm,
} from '@/lib/income-form';
import type { Income, IncomeFrequency } from '@/types/finance';

type UseIncomeFormArgs = {
  income: Income | null;
  onDone: () => void;
};

/** State and submit handler of the income form. */
export function useIncomeForm({ income, onDone }: UseIncomeFormArgs) {
  const now = useFinancialNow();
  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();
  const [form, setForm] = useState<IncomeFormState>(() =>
    income ? formFromIncome(income, now) : emptyIncomeForm(now),
  );
  const [error, setError] = useState<FormFieldError | null>(null);
  const previousStartsAt = income?.startsAt ?? null;

  function patch(changes: Partial<IncomeFormState>) {
    setError(null);
    setForm((current) => ({ ...current, ...changes }));
  }

  function setFrequency(frequency: IncomeFrequency) {
    setError(null);
    setForm((current) => applyIncomeFrequency(current, frequency, now));
  }

  async function submit() {
    setError(null);
    const problem = validateIncomeForm(form, { now, previousStartsAt });
    if (problem) {
      setError(problem);
      toast.error(problem.message);
      document.getElementById(problem.fieldId)?.focus();
      return;
    }

    const payload = buildIncomePayload(form, { now, previousStartsAt });
    try {
      if (income) {
        await updateEntry.mutateAsync({ id: income.id, payload });
        toast.success('Entrada atualizada');
      } else {
        await createEntry.mutateAsync(payload);
        toast.success('Entrada cadastrada');
      }
      onDone();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível salvar a entrada'));
    }
  }

  return {
    form,
    patch,
    setFrequency,
    error,
    now,
    previousStartsAt,
    submitting: createEntry.isPending || updateEntry.isPending,
    submit,
  };
}

export type IncomeFormApi = ReturnType<typeof useIncomeForm>;
