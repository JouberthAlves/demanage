import { Prisma } from '@/generated/prisma/client';
import { addDaysToKey, dayKeyOfDate, diffDays } from '@/lib/civil-date';

import { MarketDataError, type MarketPoint } from '../types';

/** Coinbase BTC-BRL (spot + daily candles). Pure builders and parsers. */

export const COINBASE_SPOT_URL =
  'https://api.coinbase.com/v2/prices/BTC-BRL/spot';

/** The candles endpoint returns at most 300 buckets per request. */
export const COINBASE_MAX_CANDLES = 300;

export function parseCoinbaseSpot(data: {
  data?: { amount?: string };
}): string | null {
  const value = Number(data.data?.amount);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Prisma.Decimal(data.data!.amount!).toFixed();
}

/** Splits [fromKey, toKey] into windows of at most 300 daily candles. */
export function coinbaseCandleWindows(fromKey: string, toKey: string) {
  const windows: Array<{ from: string; to: string }> = [];
  let cursor = fromKey;
  while (cursor <= toKey) {
    const maxEnd = addDaysToKey(cursor, COINBASE_MAX_CANDLES - 1);
    const end = maxEnd < toKey ? maxEnd : toKey;
    windows.push({ from: cursor, to: end });
    cursor = addDaysToKey(end, 1);
  }
  return windows;
}

export function coinbaseCandlesUrl(fromKey: string, toKey: string) {
  if (diffDays(toKey, fromKey) + 1 > COINBASE_MAX_CANDLES) {
    throw new MarketDataError('Janela de candles excede o limite do provider');
  }
  return (
    `https://api.exchange.coinbase.com/products/BTC-BRL/candles` +
    `?granularity=86400&start=${fromKey}T00:00:00Z&end=${toKey}T23:59:59Z`
  );
}

/** Candle rows are [time, low, high, open, close, volume]. */
export function parseCoinbaseCandles(
  rows: unknown,
  fromKey: string,
  toKey: string,
): MarketPoint[] {
  if (!Array.isArray(rows)) {
    throw new MarketDataError('Histórico BTC inválido');
  }
  const points: MarketPoint[] = [];
  for (const row of rows as number[][]) {
    const time = Number(row[0]);
    const close = Number(row[4]);
    if (!Number.isFinite(time) || !Number.isFinite(close) || close <= 0) {
      continue;
    }
    const day = dayKeyOfDate(new Date(time * 1000));
    if (day < fromKey || day > toKey) continue;
    points.push({
      date: day,
      value: new Prisma.Decimal(close).toFixed(2),
    });
  }
  return points;
}
