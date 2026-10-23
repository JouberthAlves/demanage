import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { runDailyMaintenance } from '@/lib/daily-maintenance';
import {
  archivePiggyBank,
  createPiggyBank,
  deletePiggyBank,
  depositPiggyBank,
  listPiggyBanks,
  listPiggyCashMovements,
  listPiggyTransactions,
  type PiggyBankPayload,
  type PiggyCorrectionOrigin,
  processPiggyAutoDebit,
  updatePiggyBank,
  withdrawPiggyBank,
} from '@/lib/piggy-api';
import { invalidateDomain, queryKeys } from '@/lib/query-keys';
import { useCalendarStore } from '@/stores/calendar-store';

export function usePiggyBanks(includeArchived = false, enabled = true) {
  const queryClient = useQueryClient();
  const dayKey = useCalendarStore((state) => state.dayKey);
  const query = useQuery({
    queryKey: queryKeys.piggyBanks.list(includeArchived),
    queryFn: () => listPiggyBanks(includeArchived),
    enabled,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!enabled || !query.isSuccess) return;
    runDailyMaintenance(queryClient, 'piggyBanks', dayKey, {
      run: processPiggyAutoDebit,
      needsRetry: (result) =>
        result.autoDebitFailedCount > 0 || result.interestStale,
      onResult: (result) => {
        if (result.autoDebitFailedCount > 0) {
          toast.error(
            'Não foi possível processar todos os débitos automáticos.',
          );
        }
        if (result.interestStale) {
          toast.error(
            'Os rendimentos do Cofrinho estão com atualização atrasada.',
          );
        }
        if (result.createdCount > 0 || result.interestCreatedCount > 0) {
          return invalidateDomain(queryClient, 'piggyBanks');
        }
        return undefined;
      },
      onError: () => {
        toast.error('Não foi possível atualizar os Cofrinhos agora.');
      },
    });
  }, [enabled, query.isSuccess, queryClient, dayKey]);

  return query;
}

export function usePiggyTransactions(piggyBankId: string | null) {
  return useQuery({
    queryKey: queryKeys.piggyBanks.transactions(piggyBankId),
    queryFn: () => listPiggyTransactions(piggyBankId ?? ''),
    enabled: Boolean(piggyBankId),
    staleTime: 60_000,
  });
}

export function usePiggyCashMovements() {
  return useQuery({
    queryKey: queryKeys.piggyBanks.cashMovements,
    queryFn: listPiggyCashMovements,
    staleTime: 60_000,
  });
}

// Every piggy mutation can move money (deposits, withdrawals, deleting or
// archiving a bank with a balance), so all of them refresh related ledgers.
function usePiggyMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateDomain(queryClient, 'piggyBanks'),
  });
}

type MoneyMovement = {
  id: string;
  amount: number;
  note?: string;
  deductFromBalance?: boolean;
  creditToBalance?: boolean;
  correctionOrigin?: PiggyCorrectionOrigin;
};

export function useCreatePiggyBank() {
  return usePiggyMutation((payload: PiggyBankPayload) =>
    createPiggyBank(payload),
  );
}

export function useUpdatePiggyBank() {
  return usePiggyMutation(
    ({ id, payload }: { id: string; payload: Partial<PiggyBankPayload> }) =>
      updatePiggyBank(id, payload),
  );
}

export function useDeletePiggyBank() {
  return usePiggyMutation((id: string) => deletePiggyBank(id));
}

export function useDepositPiggyBank() {
  return usePiggyMutation(
    ({ id, amount, note, deductFromBalance }: MoneyMovement) =>
      depositPiggyBank(id, { amount, note, deductFromBalance }),
  );
}

export function useWithdrawPiggyBank() {
  return usePiggyMutation(
    ({ id, amount, note, creditToBalance, correctionOrigin }: MoneyMovement) =>
      withdrawPiggyBank(id, {
        amount,
        note,
        creditToBalance,
        correctionOrigin,
      }),
  );
}

export function useArchivePiggyBank() {
  return usePiggyMutation((id: string) => archivePiggyBank(id));
}
