import {
  canConfirmExpensePayment,
  canPayExpenseEarly,
  isExpenseAutoDebitedThisMonth,
  isExpenseInvoicePaidThisMonth,
  isExpensePaidThisMonth,
} from '@/lib/expense-schedule';
import { expenseCashAmount } from '@/lib/expense-splits';
import type { RecurringExpense } from '@/types/finance';

export type ExpensePayState = { label: string; disabled: boolean };

export type StatusTone = 'good' | 'warn' | 'muted';
export type StatusNote = { tone: StatusTone; text: string };

/** Label and enabled state of the row's payment button. */
export function expensePayState(
  expense: RecurringExpense,
  now: Date,
  pending: boolean,
): ExpensePayState {
  if (expense.isInvoice) {
    return isExpenseInvoicePaidThisMonth(expense, now)
      ? { label: 'Pago', disabled: true }
      : { label: 'Confirmar pagamento', disabled: pending };
  }
  if (expense.frequency === 'unica') return { label: 'Pago', disabled: true };

  if (expenseCashAmount(expense) <= 0) {
    return { label: 'Via fatura', disabled: true };
  }
  if (isExpensePaidThisMonth(expense, now)) {
    return { label: 'Pago', disabled: true };
  }
  if (isExpenseAutoDebitedThisMonth(expense, now)) {
    return {
      label: 'Confirmar pagamento',
      disabled: pending || !canConfirmExpensePayment(expense, now),
    };
  }
  if (canPayExpenseEarly(expense, now)) {
    return { label: 'Pagar agora', disabled: pending };
  }
  return { label: 'Aguardando', disabled: true };
}

/** Sub-line under the expense name; null for items without a cash payment. */
export function expenseStatusNote(
  expense: RecurringExpense,
  now: Date,
): StatusNote | null {
  const recurring = expense.frequency !== 'unica' && !expense.isInvoice;
  if (!recurring || expenseCashAmount(expense) <= 0) return null;

  if (isExpensePaidThisMonth(expense, now)) {
    return { tone: 'good', text: 'Pagamento confirmado' };
  }
  if (isExpenseAutoDebitedThisMonth(expense, now)) {
    return { tone: 'warn', text: 'Já no saldo; confirme quando pagar' };
  }
  return { tone: 'muted', text: `Aguardando dia ${expense.dueDay ?? '—'}` };
}
