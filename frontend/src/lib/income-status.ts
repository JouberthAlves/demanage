import type { StatusNote } from '@/lib/expense-pay-state';
import {
  isIncomeAutoReceivedThisMonth,
  isIncomeReceivedThisMonth,
  isSalaryManuallyReceived,
  isSalaryWaitingForConfirmation,
} from '@/lib/income-schedule';
import type { EntryReceiptOccurrence, Income } from '@/types/finance';

/**
 * - salary: monthly salary, confirmed manually or by the schedule
 * - one_off: single income confirmed with "Já recebi"
 * - profile: other salary cadence, managed on the Perfil page
 * - recurring: any other monthly / weekly income
 */
export type IncomeKind = 'salary' | 'one_off' | 'profile' | 'recurring';

export type IncomeStatus = {
  kind: IncomeKind;
  salaryWaiting: boolean;
  salaryManual: boolean;
  salaryAutomatic: boolean;
  oneOffReceipt: EntryReceiptOccurrence | undefined;
  /** Sub-line under the income name. */
  note: StatusNote | null;
  /** Whether the user can edit / delete the income from this list. */
  editable: boolean;
};

export function incomeStatus(income: Income, now: Date): IncomeStatus {
  const salaryMonthly =
    income.type === 'salario' && income.frequency === 'mensal';
  const oneOff = income.frequency === 'unica';
  const salaryWaiting = isSalaryWaitingForConfirmation(income, now);
  const salaryManual = isSalaryManuallyReceived(income, now);
  const salaryAutomatic =
    salaryMonthly && isIncomeAutoReceivedThisMonth(income, now);
  const oneOffReceipt = oneOff ? income.receipts?.[0] : undefined;
  const waitingForDay: StatusNote = {
    tone: 'muted',
    text: `Aguardando dia ${income.receiveDay ?? '—'}`,
  };

  let note: StatusNote | null;
  if (salaryMonthly) {
    if (salaryWaiting) {
      note = { tone: 'warn', text: 'Aguardando confirmação manual' };
    } else if (salaryManual) {
      note = { tone: 'good', text: 'Recebimento confirmado' };
    } else if (salaryAutomatic) {
      note = { tone: 'good', text: 'Recebido automaticamente' };
    } else {
      note = waitingForDay;
    }
  } else if (oneOff) {
    note = oneOffReceipt
      ? { tone: 'good', text: 'Recebimento confirmado' }
      : { tone: 'warn', text: 'Aguardando confirmação' };
  } else {
    note = isIncomeReceivedThisMonth(income, now) ? null : waitingForDay;
  }

  const kind: IncomeKind = salaryMonthly
    ? 'salary'
    : oneOff
      ? 'one_off'
      : income.type === 'salario'
        ? 'profile'
        : 'recurring';

  return {
    kind,
    salaryWaiting,
    salaryManual,
    salaryAutomatic,
    oneOffReceipt,
    note,
    editable: kind === 'one_off' || kind === 'recurring',
  };
}

/** Label of the "wait" button next to a salary. */
export function salaryWaitLabel(status: IncomeStatus) {
  return status.salaryAutomatic || status.salaryManual
    ? 'Ainda não recebi'
    : 'Aguardar confirmação';
}
