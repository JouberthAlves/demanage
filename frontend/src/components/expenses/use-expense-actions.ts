import { useRef, useState } from 'react';
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
  const [actionPending, setActionPending] = useState(false);
  const actionLock = useRef(false);

  async function pay(expense: RecurringExpense) {
    // Single (non-invoice) expenses are already paid; nothing to register.
    if (!expense.isInvoice && expense.frequency !== 'mensal') return true;
    // "Entendi" on an already-settled invoice must not register it again.
    if (expense.isInvoice && isExpenseInvoicePaidThisMonth(expense, now)) {
      return true;
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
      return true;
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível marcar como paga'));
      return false;
    }
  }

  async function remove(expense: RecurringExpense) {
    try {
      await removeExpense.mutateAsync(expense.id);
      toast.success(`Despesa "${expense.name}" removida`);
      return true;
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível remover a despesa'));
      return false;
    }
  }

  return {
    pending: actionPending || removeExpense.isPending || markExpensePaid.isPending,
    confirmPay,
    askPay: setConfirmPay,
    confirmDelete,
    askDelete: setConfirmDelete,
    async runPay() {
      const target = confirmPay;
      if (!target || actionLock.current) return;
      actionLock.current = true;
      setActionPending(true);
      try {
        if (await pay(target)) setConfirmPay(null);
      } finally {
        actionLock.current = false;
        setActionPending(false);
      }
    },
    async runDelete() {
      const target = confirmDelete;
      if (!target || actionLock.current) return;
      actionLock.current = true;
      setActionPending(true);
      try {
        if (await remove(target)) setConfirmDelete(null);
      } finally {
        actionLock.current = false;
        setActionPending(false);
      }
    },
  };
}
