import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type AssetTransactionPayload,
  createAssetTransaction,
  deleteAssetTransaction,
  getAssetHistory,
  getAssetsSummary,
  getAssetTransactions,
  getPatrimonyHistory,
  getPatrimonySettings,
  savePatrimonySettings,
  updateAssetTransaction,
} from '@/lib/patrimony-api';
import { invalidateDomain, queryKeys } from '@/lib/query-keys';
import type { Asset, PatrimonySettings } from '@/types/patrimony';

export function useAssetsSummary() {
  return useQuery({ queryKey: queryKeys.assets.all, queryFn: getAssetsSummary });
}

export function useAssetTransactions(asset: Asset) {
  return useQuery({
    queryKey: queryKeys.assets.transactions(asset),
    queryFn: () => getAssetTransactions(asset),
  });
}

export function useAssetHistory(asset: Asset, from: string, to: string) {
  return useQuery({
    queryKey: queryKeys.assets.history(asset, from, to),
    queryFn: () => getAssetHistory(asset, from, to),
    enabled: Boolean(from && to),
  });
}

function useAssetMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateDomain(queryClient, 'assets'),
  });
}

export function useCreateAssetTransaction() {
  return useAssetMutation(
    ({ asset, payload }: { asset: Asset; payload: AssetTransactionPayload }) =>
      createAssetTransaction(asset, payload),
  );
}

export function useUpdateAssetTransaction() {
  return useAssetMutation(
    ({ id, payload }: { id: string; payload: AssetTransactionPayload }) =>
      updateAssetTransaction(id, payload),
  );
}

export function useDeleteAssetTransaction() {
  return useAssetMutation((id: string) => deleteAssetTransaction(id));
}

/**
 * `data` is `null` once loaded for an account without settings, and
 * `undefined` while loading, so callers can tell the two apart.
 */
export function usePatrimonySettings() {
  return useQuery({
    queryKey: queryKeys.patrimony.settings,
    queryFn: getPatrimonySettings,
  });
}

export function useSavePatrimonySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PatrimonySettings) => savePatrimonySettings(payload),
    onSuccess: () => invalidateDomain(queryClient, 'patrimony'),
  });
}

export function usePatrimonyHistory(
  from?: string,
  to?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.patrimony.history(from, to),
    queryFn: () => getPatrimonyHistory(from, to),
    enabled,
  });
}
