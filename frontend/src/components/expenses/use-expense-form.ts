import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import type { FormFieldError } from '@/components/shared/schedule-form/validate-schedule';
import { useCardList } from '@/hooks/use-cards';
import { useCreateExpense, useUpdateExpense } from '@/hooks/use-expenses';
import { useFinancialNow } from '@/hooks/use-financial-now';
import { getApiErrorMessage } from '@/lib/api-error';
import {
  applyExpenseFrequency,
  applyPayMode,
  buildExpensePayload,
  computeSplitShares,
  emptyExpenseForm,
  exceedsCardLimit,
  type ExpenseFormState,
  formFromExpense,
  type PayMode,
  validateExpenseForm,
} from '@/lib/expense-form';
import { parseCurrencyInput } from '@/lib/format';
import type { ExpenseFrequency, RecurringExpense } from '@/types/finance';

type UseExpenseFormArgs = {
  expense: RecurringExpense | null;
  onDone: () => void;
};

/** State, derived values and submit handler of the expense form. */
export function useExpenseForm({ expense, onDone }: UseExpenseFormArgs) {
  const now = useFinancialNow();
  const cards = useCardList();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();

  const [form, setForm] = useState<ExpenseFormState>(() =>
    expense ? formFromExpense(expense, now) : emptyExpenseForm(now),
  );
  const [error, setError] = useState<FormFieldError | null>(null);

  const previousStartsAt = expense?.startsAt ?? null;
  const validCards = useMemo(
    () => cards.filter((card) => !card.expired),
    [cards],
  );
  const editing = expense != null;
  const limitContext = { frequency: form.frequency, editing };

  const amount = parseCurrencyInput(form.amount);
  const shares = computeSplitShares(amount, form.cardPercent);
  const limitBlocked =
    exceedsCardLimit(form, amount, shares, cards, limitContext) != null;
  const submitting = createExpense.isPending || updateExpense.isPending;

  function patch(changes: Partial<ExpenseFormState>) {
    setError(null);
    setForm((current) => ({ ...current, ...changes }));
  }

  function setFrequency(frequency: ExpenseFrequency) {
    setError(null);
    setForm((current) => applyExpenseFrequency(current, frequency, now));
  }

  function setPayMode(payMode: PayMode) {
    setError(null);
    setForm((current) => applyPayMode(current, payMode, validCards));
  }

  async function submit() {
    setError(null);
    const problem = validateExpenseForm(form, {
      cards,
      editing,
      now,
      previousStartsAt,
    });
    if (problem) {
      setError(problem);
      toast.error(problem.message);
      document.getElementById(problem.fieldId)?.focus();
      return;
    }

    const payload = buildExpensePayload(form, { now, previousStartsAt });
    try {
      if (expense) {
        await updateExpense.mutateAsync({ id: expense.id, payload });
        toast.success('Despesa atualizada');
      } else {
        await createExpense.mutateAsync(payload);
        toast.success('Despesa cadastrada');
      }
      onDone();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível salvar a despesa'));
    }
  }

  return {
    form,
    patch,
    setFrequency,
    setPayMode,
    error,
    now,
    cards,
    validCards,
    limitContext,
    amount,
    shares,
    limitBlocked,
    submitting,
    submit,
    previousStartsAt,
    isUnique: form.frequency === 'unica',
    isRecurring: form.frequency === 'mensal' || form.frequency === 'semanal',
  };
}

export type ExpenseFormApi = ReturnType<typeof useExpenseForm>;
