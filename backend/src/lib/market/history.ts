import type { Asset } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import {
  addDaysToKey,
  dayKeyOfDate,
  dayKeyToDate,
} from '@/lib/civil-date';

import { cachedRange, storePoints } from './cache';
import { markRefreshed, refreshedWithin, singleFlight } from './flight';
import { getJson } from './http';
import {
  AWESOMEAPI_MAX_ROWS,
  type AwesomeHistoryRow,
  awesomeHistoryUrl,
  parseAwesomeHistory,
} from './providers/awesomeapi';
import {
  BCB_SERIES,
  bcbRangeUrl,
  type BcbRow,
  parseBcbBody,
  parseBcbRows,
} from './providers/bcb';
import {
  coinbaseCandlesUrl,
  coinbaseCandleWindows,
  parseCoinbaseCandles,
} from './providers/coinbase';
import {
  parseYahooBtcBrl,
  yahooBtcUsdUrl,
  type YahooChart,
} from './providers/yahoo';
import {
  cloneSeries,
  completedPointsOnly,
  daysBetween,
  dedupePoints,
  isFreshHistory,
  validateHistoryRange,
} from './series';
import {
  type HistoryOptions,
  MarketDataError,
  type MarketPoint,
  type MarketSeries,
  PROVIDERS,
  REFRESH_BACKOFF_MS,
} from './types';

/** Label for series served from MarketDataCache (origin may differ per row). */
const CACHE_PROVIDER_LABEL = 'cache';

type LiveHistory = { points: MarketPoint[]; provider: string; stale: boolean };

type CachedHistorySpec = {
  flightKey: string;
  cacheProvider: string;
  cacheKey: string;
  fromKey: string;
  toKey: string;
  businessDaysOnly: boolean;
  fetchLive: () => Promise<LiveHistory>;
};

/**
 * Cache-first daily history: serve the cache while it reaches the last
 * COMPLETED trading day; otherwise refresh from the provider, store only
 * completed days (UPSERT, so corrections land) and fall back to the stale
 * cache if the provider is down.
 */
export async function historyWithCache(spec: CachedHistorySpec): Promise<MarketSeries> {
  const { fromKey, toKey } = spec;
  const cached = await cachedRange(
    spec.cacheProvider,
    spec.cacheKey,
    fromKey,
    toKey,
  );
  const fresh =
    isFreshHistory(cached, fromKey, toKey, {
      businessDaysOnly: spec.businessDaysOnly,
    }) || refreshedWithin(spec.flightKey, REFRESH_BACKOFF_MS);
  if (fresh) {
    return { provider: CACHE_PROVIDER_LABEL, stale: false, points: cached };
  }

  try {
    const live = await spec.fetchLive();
    const points = completedPointsOnly(dedupePoints(live.points));
    await storePoints(spec.cacheProvider, spec.cacheKey, points);
    markRefreshed(spec.flightKey);
    return { provider: live.provider, stale: live.stale, points };
  } catch (error) {
    if (cached.length === 0) throw error;
    return { provider: CACHE_PROVIDER_LABEL, stale: true, points: cached };
  }
}

// ---------------------------------------------------------------- USD/BRL

async function fetchUsdHistoryFromAwesomeApi(fromKey: string, toKey: string) {
  const points: MarketPoint[] = [];
  let cursor = fromKey;
  while (cursor <= toKey) {
    const maxEnd = addDaysToKey(cursor, AWESOMEAPI_MAX_ROWS - 1);
    const chunkEnd = maxEnd < toKey ? maxEnd : toKey;
    const count = Math.min(
      AWESOMEAPI_MAX_ROWS,
      daysBetween(dayKeyToDate(cursor), dayKeyToDate(chunkEnd)),
    );
    const rows = await getJson<AwesomeHistoryRow[]>(
      awesomeHistoryUrl(cursor, chunkEnd, count),
      { timeoutMs: 10_000 },
    );
    points.push(...parseAwesomeHistory(rows, fromKey, toKey));
    cursor = addDaysToKey(chunkEnd, 1);
  }
  const deduped = dedupePoints(points);
  if (deduped.length === 0) throw new MarketDataError('Sem histórico USD');
  return deduped;
}

async function fetchUsdHistoryFromBcb(fromKey: string, toKey: string) {
  const points: MarketPoint[] = [];
  let cursor = addDaysToKey(fromKey, -7);
  while (cursor <= toKey) {
    const maxEnd = addDaysToKey(cursor, 359);
    const chunkEnd = maxEnd < toKey ? maxEnd : toKey;
    const body = await getJson<BcbRow[] | { erro?: { statusCode?: number } } | null>(
      bcbRangeUrl(BCB_SERIES.USD_BRL, cursor, chunkEnd),
      { onNotFound: null },
    );
    points.push(...parseBcbRows(parseBcbBody(body)));
    cursor = addDaysToKey(chunkEnd, 1);
  }
  const deduped = dedupePoints(points).filter(
    (point) => point.date >= fromKey && point.date <= toKey,
  );
  if (deduped.length === 0) throw new MarketDataError('Sem histórico USD');
  return deduped;
}

async function getUsdHistory(from: Date, to: Date): Promise<MarketSeries> {
  const fromKey = dayKeyOfDate(from);
  const toKey = dayKeyOfDate(to);
  const flightKey = `usd-history:${fromKey}:${toKey}`;
  const series = await singleFlight(flightKey, () =>
    historyWithCache({
      flightKey,
      cacheProvider: PROVIDERS.USD,
      cacheKey: 'USD_BRL_DAILY',
      fromKey,
      toKey,
      businessDaysOnly: true,
      fetchLive: async () => {
        try {
          return {
            points: await fetchUsdHistoryFromAwesomeApi(fromKey, toKey),
            provider: PROVIDERS.USD,
            stale: false,
          };
        } catch {
          return {
            points: await fetchUsdHistoryFromBcb(fromKey, toKey),
            provider: 'bcb_sgs_1',
            stale: false,
          };
        }
      },
    }),
  );
  return cloneSeries(series);
}

// ---------------------------------------------------------------- BTC/BRL

async function fetchBtcHistoryFromYahoo(from: Date, to: Date) {
  const fromKey = dayKeyOfDate(from);
  const toKey = dayKeyOfDate(to);
  const [usdSeries, yahoo] = await Promise.all([
    getUsdHistory(from, to),
    getJson<YahooChart>(yahooBtcUsdUrl(fromKey, toKey), { timeoutMs: 10_000 }),
  ]);
  const usdByDay = new Map(
    usdSeries.points.map((point) => [point.date, new Prisma.Decimal(point.value)]),
  );
  const points = parseYahooBtcBrl(yahoo, usdByDay, fromKey, toKey);
  if (points.length === 0) throw new MarketDataError('Sem histórico BTC');
  return { points, stale: usdSeries.stale };
}

/** Coinbase serves at most 300 candles per call, so long ranges are chunked. */
async function fetchBtcHistoryFromCoinbase(fromKey: string, toKey: string) {
  const points: MarketPoint[] = [];
  for (const window of coinbaseCandleWindows(fromKey, toKey)) {
    const rows = await getJson<unknown>(
      coinbaseCandlesUrl(window.from, window.to),
      { timeoutMs: 10_000 },
    );
    points.push(...parseCoinbaseCandles(rows, fromKey, toKey));
  }
  const deduped = dedupePoints(points);
  if (deduped.length === 0) throw new MarketDataError('Sem histórico BTC');
  return deduped;
}

async function getBtcHistory(from: Date, to: Date): Promise<MarketSeries> {
  const fromKey = dayKeyOfDate(from);
  const toKey = dayKeyOfDate(to);
  const flightKey = `btc-history:${fromKey}:${toKey}`;
  const series = await singleFlight(flightKey, () =>
    historyWithCache({
      flightKey,
      cacheProvider: PROVIDERS.BTC,
      cacheKey: 'BTC_BRL_DAILY',
      fromKey,
      toKey,
      businessDaysOnly: false,
      fetchLive: async () => {
        try {
          const yahoo = await fetchBtcHistoryFromYahoo(from, to);
          // Real source: Yahoo BTC-USD converted by the AwesomeAPI/BCB USD-BRL.
          return {
            points: yahoo.points,
            provider: 'yahoo_btcusd_x_usdbrl',
            stale: yahoo.stale,
          };
        } catch {
          return {
            points: await fetchBtcHistoryFromCoinbase(fromKey, toKey),
            provider: PROVIDERS.BTC,
            stale: false,
          };
        }
      },
    }),
  );
  return cloneSeries(series);
}

export async function getAssetHistory(
  asset: Asset,
  fromInput: string,
  toInput: string,
  options: HistoryOptions = {},
): Promise<MarketSeries> {
  // Only the USER's range is capped; look-back padding is added afterwards.
  const { to } = validateHistoryRange(fromInput, toInput);
  const padded = dayKeyToDate(
    addDaysToKey(fromInput, -(options.lookbackDays ?? 0)),
  );
  return asset === 'BTC' ? getBtcHistory(padded, to) : getUsdHistory(padded, to);
}
