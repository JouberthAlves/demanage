import type { Asset } from '@/generated/prisma/client';
import { badRequest, orUnavailable } from '@/http/errors';
import { todayInSaoPaulo } from '@/lib/card-billing';
import { dateKey } from '@/lib/decimal';
import {
  getAssetHistory,
  getAssetQuote,
  getCdiHistory,
  getIpcaHistory,
  MarketDataError,
  validateHistoryRange,
} from '@/lib/market-data';

export type HistoryRange = { from: string; to: string };

/**
 * Período do histórico. Padrão: hoje em São Paulo. Entrada inválida é 400
 * (validada antes de qualquer chamada ao provedor); 503 fica só para
 * indisponibilidade do provedor.
 */
export function resolveHistoryRange(
  from: string | undefined,
  to: string | undefined,
  now = new Date(),
): HistoryRange {
  const today = dateKey(todayInSaoPaulo(now));
  const range = { from: from ?? today, to: to ?? today };
  try {
    validateHistoryRange(range.from, range.to, now);
  } catch (error) {
    if (error instanceof MarketDataError) throw badRequest(error.message);
    throw error;
  }
  return range;
}

export function getAssetQuoteFor(asset: Asset) {
  return orUnavailable('Cotação indisponível e sem cache', () =>
    getAssetQuote(asset),
  );
}

export function getAssetHistorySeries(asset: Asset, range: HistoryRange) {
  return orUnavailable('Histórico indisponível', () =>
    getAssetHistory(asset, range.from, range.to),
  );
}

export function getCdiSeries(range: HistoryRange) {
  return orUnavailable('CDI indisponível', () =>
    getCdiHistory(range.from, range.to),
  );
}

export function getIpcaSeries(range: HistoryRange) {
  return orUnavailable('IPCA indisponível', () =>
    getIpcaHistory(range.from, range.to),
  );
}
