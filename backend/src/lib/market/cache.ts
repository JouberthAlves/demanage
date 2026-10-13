import { Prisma } from '@/generated/prisma/client';
import { dayKeyOfDate, dayKeyToDate } from '@/lib/civil-date';
import { prisma } from '@/lib/prisma';

import type { MarketPoint } from './types';

/** MarketDataCache access (the only DB code of the market module). */

const UPSERT_CHUNK = 200;

export async function cachedRange(
  provider: string,
  key: string,
  fromKey: string,
  toKey: string,
): Promise<MarketPoint[]> {
  const rows = await prisma.marketDataCache.findMany({
    where: {
      provider,
      key,
      at: { gte: dayKeyToDate(fromKey), lte: dayKeyToDate(toKey) },
    },
    orderBy: { at: 'asc' },
  });
  return rows.map((row) => ({
    date: dayKeyOfDate(row.at),
    value: row.value.toFixed(),
  }));
}

export async function cachedRangeWithFetchTime(
  provider: string,
  key: string,
  fromKey: string,
  toKey: string,
) {
  const rows = await prisma.marketDataCache.findMany({
    where: {
      provider,
      key,
      at: { gte: dayKeyToDate(fromKey), lte: dayKeyToDate(toKey) },
    },
    orderBy: { at: 'asc' },
    select: { at: true, value: true, fetchedAt: true },
  });
  return rows.map((row) => ({
    at: row.at,
    date: dayKeyOfDate(row.at),
    value: row.value.toFixed(),
    fetchedAt: row.fetchedAt,
  }));
}

/**
 * Writes points with UPSERT semantics: new days are inserted and days whose
 * stored value differs from the provider's are CORRECTED (the old
 * createMany/skipDuplicates froze whatever was stored first). Unchanged rows
 * are skipped unless `touch` is set (IPCA uses fetchedAt as its TTL clock).
 */
export async function storePoints(
  provider: string,
  key: string,
  points: MarketPoint[],
  options: { touch?: boolean } = {},
) {
  if (points.length === 0) return 0;

  let toWrite = points;
  if (!options.touch) {
    const dates = points.map((point) => point.date).sort();
    const existing = await cachedRange(
      provider,
      key,
      dates[0],
      dates[dates.length - 1],
    );
    const stored = new Map(existing.map((row) => [row.date, row.value]));
    toWrite = points.filter((point) => {
      const current = stored.get(point.date);
      return current === undefined || !new Prisma.Decimal(current).eq(point.value);
    });
  }

  for (let offset = 0; offset < toWrite.length; offset += UPSERT_CHUNK) {
    const chunk = toWrite.slice(offset, offset + UPSERT_CHUNK);
    await prisma.$transaction(
      chunk.map((point) => {
        const at = dayKeyToDate(point.date);
        return prisma.marketDataCache.upsert({
          where: { provider_key_at: { provider, key, at } },
          update: { value: point.value, fetchedAt: new Date() },
          create: { provider, key, at, value: point.value },
        });
      }),
    );
  }
  return toWrite.length;
}

/** Quotes are stored per UTC minute, so repeated reads upsert the same row. */
export async function cacheQuote(provider: string, key: string, value: string) {
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

export async function latestCached(provider: string, key: string) {
  return prisma.marketDataCache.findFirst({
    where: { provider, key },
    orderBy: { at: 'desc' },
  });
}
