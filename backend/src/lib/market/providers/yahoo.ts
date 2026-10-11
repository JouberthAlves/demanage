import { Prisma } from '@/generated/prisma/client';
import { addDaysToKey, dayKeyOfDate,dayKeyToDate } from '@/lib/civil-date';

import { valueOnOrBefore } from '../series';
import type { MarketPoint } from '../types';

/** Yahoo Finance BTC-USD daily closes. Pure builders and parsers. */

export type YahooChart = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

export function yahooBtcUsdUrl(fromKey: string, toKey: string) {
  const period1 = Math.floor(dayKeyToDate(fromKey, 'midnight').getTime() / 1000);
  const period2 = Math.floor(
    dayKeyToDate(addDaysToKey(toKey, 1), 'midnight').getTime() / 1000,
  );
  return `https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?period1=${period1}&period2=${period2}&interval=1d`;
}

/** BTC-USD closes (by UTC day) converted to BRL with the USD/BRL of that day. */
export function parseYahooBtcBrl(
  chart: YahooChart,
  usdByDay: Map<string, Prisma.Decimal>,
  fromKey: string,
  toKey: string,
): MarketPoint[] {
  const result = chart.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const byDay = new Map<string, string>();
  for (let index = 0; index < timestamps.length; index += 1) {
    const close = Number(closes[index]);
    if (!Number.isFinite(close) || close <= 0) continue;
    const day = dayKeyOfDate(new Date(timestamps[index] * 1000));
    if (day < fromKey || day > toKey) continue;
    const usd = valueOnOrBefore(usdByDay, day);
    if (!usd) continue;
    byDay.set(day, new Prisma.Decimal(close).mul(usd).toFixed(2));
  }
  return [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, value }));
}
