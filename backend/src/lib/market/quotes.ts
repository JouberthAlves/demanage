import type { Asset } from '@/generated/prisma/client';

import { cacheQuote, latestCached } from './cache';
import { singleFlight } from './flight';
import { getJson } from './http';
import {
  AWESOMEAPI_QUOTE_URL,
  parseAwesomeQuote,
} from './providers/awesomeapi';
import { BCB_SERIES, bcbLatestUrl, type BcbRow,parseBcbBody, parseBcbRows } from './providers/bcb';
import { COINBASE_SPOT_URL, parseCoinbaseSpot } from './providers/coinbase';
import {
  MERCADO_BITCOIN_TICKER_URL,
  parseMercadoBitcoinTicker,
} from './providers/mercadobitcoin';
import {
  MarketDataError,
  type MarketQuote,
  PROVIDERS,
  QUOTE_TTL_MS,
} from './types';

const BTC_KEY = 'BTC_BRL_QUOTE';
const USD_KEY = 'USD_BRL_QUOTE';

type LiveQuote = { value: string; provider: string };

async function fetchBtcBrlQuote(): Promise<LiveQuote> {
  try {
    const data = await getJson<{ data?: { amount?: string } }>(
      COINBASE_SPOT_URL,
      { timeoutMs: 10_000 },
    );
    const value = parseCoinbaseSpot(data);
    if (value) return { value, provider: PROVIDERS.BTC };
  } catch {
    // Coinbase às vezes cai; Mercado Bitcoin é o fallback em BRL.
  }

  const data = await getJson<{ ticker?: { last?: string } }>(
    MERCADO_BITCOIN_TICKER_URL,
    { timeoutMs: 10_000 },
  );
  return { value: parseMercadoBitcoinTicker(data), provider: 'mercadobitcoin' };
}

async function fetchUsdBrlQuote(): Promise<LiveQuote> {
  try {
    const data = await getJson<{ USDBRL?: { bid?: string } }>(
      AWESOMEAPI_QUOTE_URL,
      { timeoutMs: 10_000 },
    );
    return { value: parseAwesomeQuote(data), provider: PROVIDERS.USD };
  } catch {
    const body = await getJson<BcbRow[] | { erro?: { statusCode?: number } } | null>(
      bcbLatestUrl(BCB_SERIES.USD_BRL, 5),
      { onNotFound: null },
    );
    const last = parseBcbRows(parseBcbBody(body)).at(-1);
    if (!last) throw new MarketDataError('Cotação USD inválida');
    return { value: last.value, provider: 'bcb_sgs_1' };
  }
}

function quoteFromCache(
  provider: string,
  cached: { value: { toString(): string }; at: Date },
  stale: boolean,
): MarketQuote {
  return {
    provider,
    stale,
    value: cached.value.toString(),
    asOf: cached.at.toISOString(),
  };
}

function isFreshQuote(cached: { fetchedAt: Date } | null) {
  return cached != null && Date.now() - cached.fetchedAt.getTime() < QUOTE_TTL_MS;
}

export async function getAssetQuote(asset: Asset): Promise<MarketQuote> {
  const cacheProvider = asset === 'BTC' ? PROVIDERS.BTC : PROVIDERS.USD;
  const key = asset === 'BTC' ? BTC_KEY : USD_KEY;
  const fetchLive = asset === 'BTC' ? fetchBtcBrlQuote : fetchUsdBrlQuote;

  const quote = await singleFlight(`quote:${asset}`, async () => {
    const cached = await latestCached(cacheProvider, key);
    if (cached && isFreshQuote(cached)) {
      return quoteFromCache(cacheProvider, cached, false);
    }
    try {
      const live = await fetchLive();
      const asOf = await cacheQuote(cacheProvider, key, live.value);
      return {
        provider: live.provider,
        stale: false,
        value: live.value,
        asOf: asOf.toISOString(),
      };
    } catch (error) {
      if (!cached) throw error;
      return quoteFromCache(cacheProvider, cached, true);
    }
  });
  return { ...quote };
}
