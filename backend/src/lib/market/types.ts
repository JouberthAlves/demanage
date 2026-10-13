import { DomainError } from '@/lib/errors';

export type MarketPoint = {
  date: string;
  value: string;
};

export type MarketSeries = {
  provider: string;
  stale: boolean;
  points: MarketPoint[];
};

export type MarketQuote = {
  provider: string;
  stale: boolean;
  value: string;
  asOf: string;
};

export class MarketDataError extends DomainError {
  constructor(message: string) {
    super(message, 'MARKET_DATA');
  }
}

/** Cache provider ids (also the `provider` column of MarketDataCache). */
export const PROVIDERS = {
  BTC: 'coinbase',
  USD: 'awesomeapi',
  CDI: 'bcb_sgs_12',
  IPCA: 'ibge_sidra_1737_2266',
} as const;

/**
 * Longest range a USER may request: ten years plus ten days, inclusive.
 * Provider look-back padding (see HistoryOptions.lookbackDays) is NOT counted.
 */
export const MAX_HISTORY_RANGE_DAYS = 3663;

export const QUOTE_TTL_MS = 5 * 60 * 1000;
export const IPCA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const PROVIDER_COOLDOWN_MS = 2 * 60 * 1000;
/** After a refresh that still looks incomplete (holiday), don't refetch for this long. */
export const REFRESH_BACKOFF_MS = 30 * 60 * 1000;

export type HistoryOptions = {
  /**
   * Extra days fetched before `from` (provider look-back, e.g. to find the
   * last price before a base date). Not subject to MAX_HISTORY_RANGE_DAYS.
   */
  lookbackDays?: number;
};
