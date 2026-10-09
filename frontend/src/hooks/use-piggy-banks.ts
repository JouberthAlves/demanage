import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';

import { ENTRIES_QUERY_KEY } from '@/hooks/use-entries';
import { EXPENSES_QUERY_KEY } from '@/hooks/use-expenses';
import { PATRIMONY_QUERY_KEY } from '@/hooks/query-keys';
import { shouldRetryReadRequest } from '@/lib/query-retry';
import {
  archivePiggyBank,
  createPiggyBank,
  deletePiggyBank,
  depositPiggyBank,
  listPiggyBanks,
  listPiggyTransactions,
  processPiggyAutoDebit,
  updatePiggyBank,
  withdrawPiggyBank,
  type PiggyBankPayload,
} from '@/lib/piggy-api';

export const PIGGY_BANKS_QUERY_KEY = ['piggy-banks'] as const;

// Each authentication session has a distinct QueryClient. Do not run costly
// daily accrual/autodebit once for every hook observer or route visit.
const maintenanceStartedForSession = new WeakSet<ReturnType<typeof useQueryClient>>();

export function usePiggyBanks(includeArchived = false, enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [...PIGGY_BANKS_QUERY_KEY, { includeArchived }],
    queryFn: () => listPiggyBanks(includeArchived),
    enabled,
    staleTime: 60_000,
    retry: shouldRetryReadRequest,
  });

  useEffect(() => {
    if (!enabled || !query.isSuccess || maintenanceStartedForSession.has(queryClient)) return;
    maintenanceStartedForSession.add(queryClient);

    void processPiggyAutoDebit()
      .then((result) => {
        if (result.autoDebitFailedCount > 0) {
          toast.error('Não foi possível processar todos os débitos automáticos.');
        }
        if (result.interestStale) {
          toast.error('Os rendimentos do Cofrinho estão com atualização atrasada.');
        }
        if (result.createdCount > 0) {
          void queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
        }
        if (result.createdCount > 0 || result.interestCreatedCount > 0) {
          void queryClient.invalidateQueries({
            queryKey: PIGGY_BANKS_QUERY_KEY,
          });
        }
        if (result.interestCreatedCount > 0) {
          void queryClient.invalidateQueries({ queryKey: PATRIMONY_QUERY_KEY });
        }
      })
      .catch(() => {
        toast.error('Não foi possível atualizar os Cofrinhos agora.');
      });
  }, [enabled, query.isSuccess, queryClient]);

  return query;
}

export function usePiggyTransactions(piggyBankId: string | null) {
  return useQuery({
    queryKey: [...PIGGY_BANKS_QUERY_KEY, piggyBankId, 'transactions'],
    queryFn: () => listPiggyTransactions(piggyBankId as string),
    enabled: Boolean(piggyBankId),
    staleTime: 60_000,
    retry: shouldRetryReadRequest,
  });
}

function invalidatePiggyRelated(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({ queryKey: PIGGY_BANKS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY });
}

export function useCreatePiggyBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PiggyBankPayload) => createPiggyBank(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIGGY_BANKS_QUERY_KEY });
    },
  });
}

export function useUpdatePiggyBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Partial<PiggyBankPayload>;
    }) => updatePiggyBank(id, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIGGY_BANKS_QUERY_KEY });
    },
  });
}

export function useDeletePiggyBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deletePiggyBank(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIGGY_BANKS_QUERY_KEY });
    },
  });
}

export function useDepositPiggyBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      amount,
      note,
    }: {
      id: string;
      amount: number;
      note?: string;
    }) => depositPiggyBank(id, { amount, note }),
    onSuccess: () => invalidatePiggyRelated(queryClient),
  });
}

export function useWithdrawPiggyBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      amount,
      note,
    }: {
      id: string;
      amount: number;
      note?: string;
    }) => withdrawPiggyBank(id, { amount, note }),
    onSuccess: () => invalidatePiggyRelated(queryClient),
  });
}

export function useArchivePiggyBank() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archivePiggyBank(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PIGGY_BANKS_QUERY_KEY });
    },
  });
}
