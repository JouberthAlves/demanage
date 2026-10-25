import { parseDayKey, todayKey } from '@/lib/dates';
import type { Income } from '@/types/finance';

/** A one-off credit only becomes cash after the owner confirms its actual date. */
export function buildOneOffReceiptConfirmation(
  income: Income,
  receivedOn: string,
  now: Date = new Date(),
) {
  if (income.frequency !== 'unica' || !income.updatedAt) {
    throw new Error('Atualize as entradas antes de confirmar o recebimento');
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(receivedOn) ||
    !parseDayKey(receivedOn) ||
    receivedOn > todayKey(now)
  ) {
    throw new Error('Escolha uma data de recebimento válida, até hoje');
  }
  if (income.receipts?.length) {
    throw new Error('Essa entrada já tem um recebimento confirmado');
  }

  return {
    id: income.id,
    month: receivedOn.slice(0, 7),
    state: 'received' as const,
    receivedOn,
    expectedUpdatedAt: income.updatedAt,
  };
}

/** The current row version fences undo from a prior/replayed confirmation. */
export function buildOneOffReceiptUndo(income: Income) {
  const receipt = income.receipts?.[0];
  if (income.frequency !== 'unica' || !receipt || !income.updatedAt) {
    throw new Error('Atualize as entradas antes de desfazer o recebimento');
  }
  return {
    id: income.id,
    month: receipt.month,
    state: 'waiting' as const,
    expectedUpdatedAt: income.updatedAt,
  };
}
