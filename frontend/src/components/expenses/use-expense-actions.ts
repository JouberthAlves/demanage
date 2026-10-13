import { useState } from 'react';
import { toast } from 'sonner';

import {
  useDeleteExpense,
  useMarkExpensePaid,
} from '@/hooks/use-expenses';
import { getApiErrorMessage } from '@/lib/api-error';
import {
  expenseMonthKey,
  isExpenseInvoicePaidThisMonth,
} from '@/lib/expense-schedule';
import type { RecurringExpense } from '@/types/finance';

/** Pay / delete confirmations and mutations of the expenses page. */
export function useExpenseActions(now: Date) {
  const removeExpense = useDeleteExpense();
  const markExpensePaid = useMarkExpensePaid();
  const [confirmPay, setConfirmPay] = useState<RecurringExpense | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RecurringExpense | null>(
    null,
  );

  async function pay(expense: RecurringExpense) {
    // Single (non-invoice) expenses are already paid; nothing to register.
    if (!expense.isInvoice && expense.frequency !== 'mensal') return;
    // "Entendi" on an already-settled invoice must not register it again.
    if (expense.isInvoice && isExpenseInvoicePaidThisMonth(expense, now)) {
      return;
    }
    try {
      await markExpensePaid.mutateAsync({
        id: expense.id,
        month: expense.isInvoice
          ? (expense.billingPeriodEnd?.slice(0, 7) ?? expenseMonthKey(now))
          : expenseMonthKey(now),
      });
      toast.success(
        expense.isInvoice
          ? `Pagamento da fatura de "${expense.name}" registrado`
          : `Pagamento de "${expense.name}" registrado neste mês`,
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível marcar como paga'));
    }
  }

  async function remove(expense: RecurringExpense) {
    try {
      await removeExpense.mutateAsync(expense.id);
      toast.success(`Despesa "${expense.name}" removida`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível remover a despesa'));
    }
  }

  return {
    pending: removeExpense.isPending || markExpensePaid.isPending,
    confirmPay,
    askPay: setConfirmPay,
    confirmDelete,
    askDelete: setConfirmDelete,
    async runPay() {
      const target = confirmPay;
      setConfirmPay(null);
      if (target) await pay(target);
    },
    async runDelete() {
      const target = confirmDelete;
      setConfirmDelete(null);
      if (target) await remove(target);
    },
  };
}
