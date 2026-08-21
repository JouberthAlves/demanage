import type { Asset } from '@prisma/client';

import { dateKey, dateOnlyUtc, decimal } from '@/lib/decimal';
import { prisma } from '@/lib/prisma';

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

export class MarketDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarketDataError';
  }
}

const PROVIDERS = {
  BTC: 'coinbase',
  USD: 'awesomeapi',
  CDI: 'bcb_sgs_12',
  IPCA: 'ibge_sidra_1737_2266',
} as const;

function parseDateInput(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new MarketDataError('Data inválida');
  return new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12),
  );
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function daysBetween(from: Date, to: Date) {
  return Math.max(
    1,
    Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1,
  );
}

function yyyymmdd(date: Date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function ddmmyyyy(date: Date) {
  const [year, month, day] = date.toISOString().slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function tlsCauseCode(error: unknown): string {
  const cause =
    error instanceof Error && 'cause' in error ? error.cause : error;
  if (cause && typeof cause === 'object' && 'code' in cause) {
    return String(cause.code);
  }
  return '';
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'deManage/1.0' },
    });
    if (!response.ok) {
      throw new MarketDataError(`Provider respondeu ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      throw new MarketDataError('Provider bloqueado pela rede');
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof MarketDataError) throw error;
    const code = tlsCauseCode(error);
    if (
      code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    ) {
      throw new MarketDataError(
        'A rede corporativa interceptou o HTTPS deste provider',
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

type BcbRow = { data?: string; valor?: string };

function parseBcbRows(rows: BcbRow[]): MarketPoint[] {
  const points: MarketPoint[] = [];
  for (const row of rows) {
    if (!row.data || row.valor == null) continue;
    const [day, month, year] = row.data.split('/');
    const value = Number(row.valor.replace(',', '.'));
    if (!Number.isFinite(value) || value < 0) continue;
    points.push({
      date: `${year}-${month}-${day}`,
      value: decimal(value).toString(),
    });
  }
  return points;
}

async function fetchBcbRows(url: string): Promise<BcbRow[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'deManage/1.0' },
    });
    if (response.status === 404) return [];
    if (!response.ok) {
      throw new MarketDataError(`Provider respondeu ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      throw new MarketDataError('Provider bloqueado pela rede');
    }
    const body = (await response.json()) as
      | BcbRow[]
      | { erro?: { statusCode?: number } };
    if (!Array.isArray(body)) {
      if (body.erro?.statusCode === 404) return [];
      throw new MarketDataError('Resposta CDI inválida');
    }
    return body;
  } catch (error) {
    if (error instanceof MarketDataError) throw error;
    const code = tlsCauseCode(error);
    if (
      code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
    ) {
      throw new MarketDataError(
        'A rede corporativa interceptou o HTTPS deste provider',
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function storePoints(
  provider: string,
  key: string,
  points: MarketPoint[],
) {
  if (points.length === 0) return;
  await prisma.marketDataCache.createMany({
    data: points.map((point) => ({
      provider,
      key,
      at: parseDateInput(point.date),
      value: point.value,
    })),
    skipDuplicates: true,
  });
}

async function cachedRange(
  provider: string,
  key: string,
  from: Date,
  to: Date,
) {
  const cached = await prisma.marketDataCache.findMany({
    where: { provider, key, at: { gte: from, lte: to } },
    orderBy: { at: 'asc' },
  });
  return cached.map((point) => ({
    date: dateKey(point.at),
    value: point.value.toString(),
  }));
}

async function cacheQuote(provider: string, key: string, value: string) {
  const now = new Date();
  const minute = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
    ),
  );
  await prisma.marketDataCache.upsert({
    where: { provider_key_at: { provider, key, at: minute } },
    update: { value, fetchedAt: new Date() },
    create: { provider, key, at: minute, value },
  });
  return minute;
}

async function latestCached(provider: string, key: string) {
  return prisma.marketDataCache.findFirst({
    where: { provider, key },
    orderBy: { at: 'desc' },
  });
}

async function fetchBtcBrlQuote(): Promise<string> {
  try {
    const data = await fetchJson<{ data?: { amount?: string } }>(
      'https://api.coinbase.com/v2/prices/BTC-BRL/spot',
    );
    const value = Number(data.data?.amount);
    if (Number.isFinite(value) && value > 0) return decimal(value).toString();
  } catch {
    // Coinbase às vezes cai; Mercado Bitcoin é o fallback em BRL.
  }

  const data = await fetchJson<{ ticker?: { last?: string } }>(
    'https://www.mercadobitcoin.net/api/BTC/ticker/',
  );
  const value = Number(data.ticker?.last);
  if (!Number.isFinite(value) || value <= 0) {
    throw new MarketDataError('Cotação BTC inválida');
  }
  return decimal(value).toString();
}

export async function getAssetQuote(asset: Asset): Promise<MarketQuote> {
  if (asset === 'BTC') {
    try {
      const parsed = await fetchBtcBrlQuote();
      const asOf = await cacheQuote(PROVIDERS.BTC, 'BTC_BRL_QUOTE', parsed);
      return {
        provider: PROVIDERS.BTC,
        stale: false,
        value: parsed,
        asOf: asOf.toISOString(),
      };
    } catch (error) {
      const cached = await latestCached(PROVIDERS.BTC, 'BTC_BRL_QUOTE');
      if (!cached) throw error;
      return {
        provider: PROVIDERS.BTC,
        stale: true,
        value: cached.value.toString(),
        asOf: cached.at.toISOString(),
      };
    }
  }

  try {
    const data = await fetchJson<{ USDBRL?: { bid?: string } }>(
      'https://economia.awesomeapi.com.br/json/last/USD-BRL',
    );
    const bid = Number(data.USDBRL?.bid);
    if (!Number.isFinite(bid) || bid <= 0) {
      throw new MarketDataError('Cotação USD inválida');
    }
    const parsed = decimal(bid).toString();
    const asOf = await cacheQuote(PROVIDERS.USD, 'USD_BRL_QUOTE', parsed);
    return {
      provider: PROVIDERS.USD,
      stale: false,
      value: parsed,
      asOf: asOf.toISOString(),
    };
  } catch (error) {
    const cached = await latestCached(PROVIDERS.USD, 'USD_BRL_QUOTE');
    if (!cached) throw error;
    return {
      provider: PROVIDERS.USD,
      stale: true,
      value: cached.value.toString(),
      asOf: cached.at.toISOString(),
    };
  }
}

export async function getAssetHistory(
  asset: Asset,
  fromInput: string,
  toInput: string,
): Promise<MarketSeries> {
  const from = parseDateInput(fromInput);
  const to = parseDateInput(toInput);
  if (from > to) throw new MarketDataError('Período inválido');
  return asset === 'BTC' ? getBtcHistory(from, to) : getUsdHistory(from, to);
}

type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

function usdOnOrBefore(
  usdByDay: Map<string, ReturnType<typeof decimal>>,
  day: string,
) {
  const exact = usdByDay.get(day);
  if (exact) return exact;
  let found: ReturnType<typeof decimal> | undefined;
  for (const key of usdByDay.keys()) {
    if (key > day) break;
    found = usdByDay.get(key);
  }
  return found;
}

async function getBtcHistory(from: Date, to: Date): Promise<MarketSeries> {
  const provider = PROVIDERS.BTC;
  const key = 'BTC_BRL_DAILY';
  try {
    const period1 = Math.floor(from.getTime() / 1000);
    const period2 = Math.floor(addDays(to, 1).getTime() / 1000);
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?period1=${period1}&period2=${period2}&interval=1d`;
    const [usdSeries, yahoo] = await Promise.all([
      getUsdHistory(from, to),
      fetchJson<YahooChart>(yahooUrl),
    ]);
    const usdByDay = new Map(
      [...usdSeries.points]
        .sort((left, right) => left.date.localeCompare(right.date))
        .map((point) => [point.date, decimal(point.value)]),
    );
    const result = yahoo.chart?.result?.[0];
    const timestamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const byDay = new Map<string, string>();
    for (let index = 0; index < timestamps.length; index += 1) {
      const close = Number(closes[index]);
      if (!Number.isFinite(close) || close <= 0) continue;
      const day = dateKey(new Date(timestamps[index] * 1000));
      if (day < dateKey(from) || day > dateKey(to)) continue;
      const usd = usdOnOrBefore(usdByDay, day);
      if (!usd) continue;
      byDay.set(day, decimal(close).mul(usd).toFixed(2));
    }
    const points = [...byDay.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => ({ date, value }));
    if (points.length === 0) throw new MarketDataError('Sem histórico BTC');
    await storePoints(provider, key, points);
    return { provider, stale: usdSeries.stale, points };
  } catch (error) {
    const points = await cachedRange(provider, key, from, to);
    if (points.length === 0) throw error;
    return { provider, stale: true, points };
  }
}

async function getUsdHistory(from: Date, to: Date): Promise<MarketSeries> {
  const provider = PROVIDERS.USD;
  const key = 'USD_BRL_DAILY';
  try {
    const points: MarketPoint[] = [];
    let cursor = from;
    while (cursor <= to) {
      const chunkEnd = new Date(
        Math.min(to.getTime(), addDays(cursor, 359).getTime()),
      );
      const count = Math.min(360, daysBetween(cursor, chunkEnd));
      const url = `https://economia.awesomeapi.com.br/json/daily/USD-BRL/${count}?start_date=${yyyymmdd(cursor)}&end_date=${yyyymmdd(chunkEnd)}`;
      const rows = await fetchJson<
        Array<{ bid?: string; timestamp?: string; create_date?: string }>
      >(url);
      for (const row of rows) {
        const bid = Number(row.bid);
        if (!Number.isFinite(bid) || bid <= 0) continue;
        const timestamp = Number(row.timestamp);
        const date =
          Number.isFinite(timestamp) && timestamp > 0
            ? dateKey(new Date(timestamp * 1000))
            : row.create_date?.slice(0, 10);
        if (!date || date < dateKey(from) || date > dateKey(to)) continue;
        points.push({ date, value: decimal(bid).toString() });
      }
      cursor = addDays(chunkEnd, 1);
    }
    const deduped = dedupePoints(points);
    if (deduped.length === 0) throw new MarketDataError('Sem histórico USD');
    await storePoints(provider, key, deduped);
    return { provider, stale: false, points: deduped };
  } catch (error) {
    const points = await cachedRange(provider, key, from, to);
    if (points.length === 0) throw error;
    return { provider, stale: true, points };
  }
}

export async function getCdiHistory(
  fromInput: string,
  toInput: string,
): Promise<MarketSeries> {
  const from = parseDateInput(fromInput);
  const to = parseDateInput(toInput);
  const provider = PROVIDERS.CDI;
  const key = 'CDI_DAILY_PERCENT';
  if (from > to) throw new MarketDataError('Período inválido');

  try {
    const points: MarketPoint[] = [];
    const requestFrom = addDays(from, -14);
    let cursor = requestFrom;
    while (cursor <= to) {
      const chunkEnd = new Date(
        Math.min(
          to.getTime(),
          new Date(
            Date.UTC(
              cursor.getUTCFullYear() + 9,
              cursor.getUTCMonth(),
              cursor.getUTCDate(),
              12,
            ),
          ).getTime(),
        ),
      );
      const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${ddmmyyyy(cursor)}&dataFinal=${ddmmyyyy(chunkEnd)}`;
      const rows = await fetchBcbRows(url);
      points.push(...parseBcbRows(rows));
      cursor = addDays(chunkEnd, 1);
    }
    let deduped = dedupePoints(points);
    if (deduped.length === 0) {
      const latest = await fetchBcbRows(
        'https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados/ultimos/30?formato=json',
      );
      deduped = dedupePoints(parseBcbRows(latest));
    }
    if (deduped.length === 0) throw new MarketDataError('Sem histórico CDI');
    await storePoints(provider, key, deduped);
    return { provider, stale: false, points: deduped };
  } catch (error) {
    const points = await cachedRange(provider, key, from, to);
    if (points.length === 0) throw error;
    return { provider, stale: true, points };
  }
}

export async function getIpcaHistory(
  fromInput: string,
  toInput: string,
): Promise<MarketSeries> {
  const from = parseDateInput(fromInput);
  const to = parseDateInput(toInput);
  const provider = PROVIDERS.IPCA;
  const key = 'IPCA_INDEX_EFFECTIVE';
  if (from > to) throw new MarketDataError('Período inválido');

  try {
    const rows = await fetchJson<Array<Record<string, string>>>(
      'https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/all',
    );
    const today = dateOnlyUtc(new Date());
    const points: MarketPoint[] = [];
    for (const row of rows.slice(1)) {
      const period = Object.values(row).find((value) => /^\d{6}$/.test(value));
      const rawValue = row.V;
      if (!period || !rawValue || rawValue === '...') continue;
      const value = Number(rawValue.replace(',', '.'));
      if (!Number.isFinite(value) || value <= 0) continue;
      const year = Number(period.slice(0, 4));
      const month = Number(period.slice(4, 6));
      // Conservador contra lookahead: o índice só passa a valer no dia 15
      // do mês seguinte ao mês de referência. Isso nunca antecipa publicação.
      const effectiveAt = new Date(Date.UTC(year, month, 15, 12));
      if (effectiveAt > today || effectiveAt < from || effectiveAt > to) continue;
      points.push({ date: dateKey(effectiveAt), value: decimal(value).toString() });
    }
    const deduped = dedupePoints(points);
    if (deduped.length === 0) {
      const broadFrom = new Date(Date.UTC(from.getUTCFullYear() - 2, 0, 1, 12));
      const cached = await cachedRange(provider, key, broadFrom, to);
      if (cached.length > 0) return { provider, stale: true, points: cached };
      throw new MarketDataError('Sem histórico IPCA no período');
    }
    await storePoints(provider, key, deduped);
    return { provider, stale: false, points: deduped };
  } catch (error) {
    const broadFrom = new Date(Date.UTC(from.getUTCFullYear() - 2, 0, 1, 12));
    const points = await cachedRange(provider, key, broadFrom, to);
    if (points.length === 0) throw error;
    return { provider, stale: true, points };
  }
}

function dedupePoints(points: MarketPoint[]) {
  const map = new Map<string, string>();
  for (const point of points) map.set(point.date, point.value);
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, value }));
}
