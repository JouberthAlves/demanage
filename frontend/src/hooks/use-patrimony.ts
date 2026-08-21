import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ENTRIES_QUERY_KEY } from '@/hooks/use-entries';
import { EXPENSES_QUERY_KEY } from '@/hooks/use-expenses';
import { PIGGY_BANKS_QUERY_KEY } from '@/hooks/use-piggy-banks';
import {
  createAssetTransaction,
  deleteAssetTransaction,
  getAssetHistory,
  getAssetTransactions,
  getAssetsSummary,
  getPatrimonyHistory,
  getPatrimonySettings,
  savePatrimonySettings,
  type AssetTransactionPayload,
} from '@/lib/patrimony-api';
import type { Asset, PatrimonySettings } from '@/types/patrimony';

export const ASSETS_QUERY_KEY = ['assets'] as const;
export const PATRIMONY_QUERY_KEY = ['patrimony'] as const;

export function useAssetsSummary() {
  return useQuery({ queryKey: ASSETS_QUERY_KEY, queryFn: getAssetsSummary });
}

export function useAssetTransactions(asset: Asset) {
  return useQuery({
    queryKey: [...ASSETS_QUERY_KEY, asset, 'transactions'],
    queryFn: () => getAssetTransactions(asset),
  });
}

export function useAssetHistory(asset: Asset, from: string, to: string) {
  return useQuery({
    queryKey: [...ASSETS_QUERY_KEY, asset, 'history', from, to],
    queryFn: () => getAssetHistory(asset, from, to),
    enabled: Boolean(from && to),
  });
}

function invalidateAssetRelated(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ASSETS_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: PATRIMONY_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: PIGGY_BANKS_QUERY_KEY });
}

export function useCreateAssetTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      asset,
      payload,
    }: {
      asset: Asset;
      payload: AssetTransactionPayload;
    }) => createAssetTransaction(asset, payload),
    onSuccess: () => invalidateAssetRelated(queryClient),
  });
}

export function useDeleteAssetTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAssetTransaction,
    onSuccess: () => invalidateAssetRelated(queryClient),
  });
}

export function usePatrimonySettings() {
  return useQuery({
    queryKey: [...PATRIMONY_QUERY_KEY, 'settings'],
    queryFn: getPatrimonySettings,
    initialData: null,
  });
}

export function useSavePatrimonySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PatrimonySettings) => savePatrimonySettings(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PATRIMONY_QUERY_KEY });
    },
  });
}

export function usePatrimonyHistory(
  from?: string,
  to?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: [...PATRIMONY_QUERY_KEY, 'history', from, to],
    queryFn: () => getPatrimonyHistory(from, to),
    enabled,
  });
}
