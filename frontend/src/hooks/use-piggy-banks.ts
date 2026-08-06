import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ENTRIES_QUERY_KEY } from '@/hooks/use-entries';
import { EXPENSES_QUERY_KEY } from '@/hooks/use-expenses';
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

export function usePiggyBanks(includeArchived = false) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: [...PIGGY_BANKS_QUERY_KEY, { includeArchived }],
    queryFn: async () => {
      const auto = await processPiggyAutoDebit();
      if (auto.createdCount > 0) {
        void queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      }
      return listPiggyBanks(includeArchived);
    },
  });
}

export function usePiggyTransactions(piggyBankId: string | null) {
  return useQuery({
    queryKey: [...PIGGY_BANKS_QUERY_KEY, piggyBankId, 'transactions'],
    queryFn: () => listPiggyTransactions(piggyBankId as string),
    enabled: Boolean(piggyBankId),
  });
}

function invalidatePiggyRelated(queryClient: ReturnType<typeof useQueryClient>) {
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
