import { api } from '@/lib/api';
import type {
  Asset,
  AssetPosition,
  AssetsSummary,
  AssetTransaction,
  AssetTransactionType,
  MarketSeries,
  PatrimonyHistory,
  PatrimonySettings,
} from '@/types/patrimony';

export type AssetTransactionPayload = {
  type: AssetTransactionType;
  quantity: string;
  cashAmountBrl: string;
  feeAmountBrl?: string;
  feePercent?: string;
  costBasisKnown?: boolean;
  date: string;
  note?: string | null;
};

export async function getAssetsSummary() {
  const { data } = await api.get<AssetsSummary>('/assets');
  return data;
}

export async function getAssetPosition(asset: Asset) {
  const { data } = await api.get<AssetPosition>(`/assets/${asset}`);
  return data;
}

export async function getAssetTransactions(asset: Asset) {
  const { data } = await api.get<AssetTransaction[]>(
    `/assets/${asset}/transactions`,
  );
  return data;
}

export async function createAssetTransaction(
  asset: Asset,
  payload: AssetTransactionPayload,
) {
  const { data } = await api.post<AssetTransaction>(
    `/assets/${asset}/transactions`,
    payload,
  );
  return data;
}

export async function updateAssetTransaction(
  id: string,
  payload: AssetTransactionPayload,
) {
  const { data } = await api.patch<AssetTransaction>(
    `/assets/transactions/${id}`,
    payload,
  );
  return data;
}

export async function deleteAssetTransaction(id: string) {
  await api.delete(`/assets/transactions/${id}`);
}

export async function getAssetHistory(
  asset: Asset,
  from: string,
  to: string,
) {
  const { data } = await api.get<MarketSeries>(`/market/history/${asset}`, {
    params: { from, to },
  });
  return data;
}

export async function getPatrimonySettings() {
  const { data } = await api.get<PatrimonySettings | null>(
    '/patrimony/settings',
  );
  return data;
}

export async function savePatrimonySettings(payload: PatrimonySettings) {
  const { data } = await api.put<PatrimonySettings>(
    '/patrimony/settings',
    payload,
  );
  return data;
}

export async function getPatrimonyHistory(from?: string, to?: string) {
  const { data } = await api.get<PatrimonyHistory>('/patrimony/history', {
    params: { from, to },
  });
  return data;
}
