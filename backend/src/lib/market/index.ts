/**
 * Market data public API.
 *   types.ts      constants + error + shapes (pure)
 *   series.ts     validation, freshness, dedupe (pure)
 *   providers/*   URL builders and parsers per provider (pure)
 *   http.ts       the single fetch wrapper (timeout, cooldown, size cap)
 *   cache.ts      MarketDataCache (DB)
 *   quotes.ts / history.ts (USD, BTC) / rates.ts (CDI, IPCA)   orchestration
 */
export { getAssetHistory } from './history';
export { ipcaPeriodRange } from './providers/ibge';
export { getAssetQuote } from './quotes';
export { getCdiHistory, getIpcaHistory } from './rates';
export { validateHistoryRange } from './series';
export {
  type HistoryOptions,
  MarketDataError,
  type MarketPoint,
  type MarketQuote,
  type MarketSeries,
  MAX_HISTORY_RANGE_DAYS,
} from './types';
