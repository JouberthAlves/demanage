import { Prisma } from '@/generated/prisma/client';
import { dayKeyOfDate } from '@/lib/civil-date';

import { MarketDataError, type MarketPoint } from '../types';

/** AwesomeAPI USD-BRL. Pure URL builders and parsers. */

export const AWESOMEAPI_MAX_ROWS = 360;

export const AWESOMEAPI_QUOTE_URL =
  'https://economia.awesomeapi.com.br/json/last/USD-BRL';

export function awesomeHistoryUrl(
  startKey: string,
  endKey: string,
  count: number,
) {
  const compact = (key: string) => key.replaceAll('-', '');
  return `https://economia.awesomeapi.com.br/json/daily/USD-BRL/${count}?start_date=${compact(startKey)}&end_date=${compact(endKey)}`;
}

export function parseAwesomeQuote(data: {
  USDBRL?: { bid?: string };
}): string {
  const bid = Number(data.USDBRL?.bid);
  if (!Number.isFinite(bid) || bid <= 0) {
    throw new MarketDataError('Cotação USD inválida');
  }
  return new Prisma.Decimal(data.USDBRL!.bid!).toFixed();
}

export type AwesomeHistoryRow = {
  bid?: string;
  timestamp?: string;
  create_date?: string;
};

export function parseAwesomeHistory(
  rows: AwesomeHistoryRow[],
  fromKey: string,
  toKey: string,
): MarketPoint[] {
  const points: MarketPoint[] = [];
  for (const row of rows) {
    const bid = Number(row.bid);
    if (!Number.isFinite(bid) || bid <= 0) continue;
    const timestamp = Number(row.timestamp);
    const date =
      Number.isFinite(timestamp) && timestamp > 0
        ? dayKeyOfDate(new Date(timestamp * 1000))
        : row.create_date?.slice(0, 10);
    if (!date || date < fromKey || date > toKey) continue;
    points.push({ date, value: new Prisma.Decimal(row.bid!).toFixed() });
  }
  return points;
}
