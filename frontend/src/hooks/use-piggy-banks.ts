import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  archivePiggyBank,
  createPiggyBank,
  deletePiggyBank,
  depositPiggyBank,
  listPiggyBanks,
  listPiggyTransactions,
  type PiggyBankPayload,
  processPiggyAutoDebit,
  updatePiggyBank,
  withdrawPiggyBank,
} from '@/lib/piggy-api';
import { invalidateDomain, queryKeys } from '@/lib/query-keys';

// Each authentication session has a distinct QueryClient. Do not run costly
// daily accrual/autodebit once for every hook observer or route visit.
const maintenanceStartedForSession = new WeakSet<ReturnType<typeof useQueryClient>>();

export function usePiggyBanks(includeArchived = false, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.piggyBanks.list(includeArchived),
    queryFn: () => listPiggyBanks(includeArchived),
    enabled,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!enabled || !query.isSuccess || maintenanceStartedForSession.has(queryClient)) return;
    maintenanceStartedForSession.add(queryClient);

    processPiggyAutoDebit()
      .then((result) => {
        if (result.autoDebitFailedCount > 0) {
          toast.error('Não foi possível processar todos os débitos automáticos.');
        }
        if (result.interestStale) {
          toast.error('Os rendimentos do Cofrinho estão com atualização atrasada.');
        }
        if (result.createdCount > 0 || result.interestCreatedCount > 0) {
          return invalidateDomain(queryClient, 'piggyBanks').then(() => undefined);
        }
        return undefined;
      })
      .catch(() => {
        // Allow a later mount to retry the maintenance run.
        maintenanceStartedForSession.delete(queryClient);
        toast.error('Não foi possível atualizar os Cofrinhos agora.');
      });
  }, [enabled, query.isSuccess, queryClient]);

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

type MoneyMovement = { id: string; amount: number; note?: string };

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
  return usePiggyMutation(({ id, amount, note }: MoneyMovement) =>
    depositPiggyBank(id, { amount, note }),
  );
}

export function useWithdrawPiggyBank() {
  return usePiggyMutation(({ id, amount, note }: MoneyMovement) =>
    withdrawPiggyBank(id, { amount, note }),
  );
}

export function useArchivePiggyBank() {
  return usePiggyMutation((id: string) => archivePiggyBank(id));
}
