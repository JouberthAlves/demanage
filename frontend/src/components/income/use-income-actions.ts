import { useState } from 'react';
import { toast } from 'sonner';

import { useDeleteEntry, useEntryReceiptState } from '@/hooks/use-entries';
import { getApiErrorMessage } from '@/lib/api-error';
import {
  buildOneOffReceiptConfirmation,
  buildOneOffReceiptUndo,
} from '@/lib/income-receipt-confirmation';
import { incomeMonthKey } from '@/lib/income-schedule';
import type { Income } from '@/types/finance';

import type { ReceiptHandler } from './income-row-actions';

/** Receipt confirmation, delete confirmation and their mutations. */
export function useIncomeActions(now: Date) {
  const removeEntry = useDeleteEntry();
  const entryReceipt = useEntryReceiptState();
  const [confirmDelete, setConfirmDelete] = useState<Income | null>(null);
  const [receiptToConfirm, setReceiptToConfirm] = useState<Income | null>(null);

  const setReceipt: ReceiptHandler = (income, state, month) => {
    if (income.frequency === 'unica' && state === 'received') {
      setReceiptToConfirm(income);
      return;
    }
    void (async () => {
      try {
        await entryReceipt.mutateAsync(
          income.frequency === 'unica'
            ? buildOneOffReceiptUndo(income)
            : { id: income.id, month: month ?? incomeMonthKey(now), state },
        );
        const isOneOff = income.frequency === 'unica';
        toast.success(
          state === 'received'
            ? isOneOff
              ? 'Recebimento da entrada registrado'
              : 'Salário confirmado no saldo'
            : isOneOff
              ? 'Recebimento removido'
              : 'Salário aguardará sua confirmação neste mês',
        );
      } catch (err) {
        toast.error(
          getApiErrorMessage(err, 'Não foi possível atualizar o recebimento'),
        );
      }
    })();
  };

  async function runConfirmReceipt(receivedOn: string) {
    const target = receiptToConfirm;
    if (!target) return;
    try {
      await entryReceipt.mutateAsync(
        buildOneOffReceiptConfirmation(target, receivedOn, now),
      );
      setReceiptToConfirm(null);
      toast.success('Recebimento da entrada registrado na data informada');
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, 'Não foi possível confirmar o recebimento'),
      );
    }
  }

  async function runDelete() {
    const target = confirmDelete;
    setConfirmDelete(null);
    if (!target) return;
    try {
      await removeEntry.mutateAsync(target.id);
      toast.success(`Entrada "${target.name}" removida`);
    } catch (err) {
      toast.error(
        getApiErrorMessage(err, 'Não foi possível remover a entrada'),
      );
    }
  }

  return {
    receiptPending: entryReceipt.isPending,
    deletePending: removeEntry.isPending,
    setReceipt,
    receiptToConfirm,
    dismissReceiptConfirmation: () => setReceiptToConfirm(null),
    runConfirmReceipt,
    confirmDelete,
    askDelete: setConfirmDelete,
    runDelete,
  };
}
