import { Prisma } from '@/generated/prisma/client';
import {
  addDaysToKey,
  type DayKey,
  dayKeyToDate,
  diffDays,
  parseDayKey,
  todayKeyInSaoPaulo,
  weekdayOfKey,
} from '@/lib/civil-date';

import {
  MarketDataError,
  type MarketPoint,
  type MarketSeries,
  MAX_HISTORY_RANGE_DAYS,
} from './types';

/** Pure series helpers (validation, freshness, de-duplication). */

/** Inclusive number of days between two dates (at least 1). */
export function daysBetween(from: Date, to: Date) {
  return Math.max(
    1,
    Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1,
  );
}

/**
 * Validates a USER-requested range (strict dates, no future, cap of ten years
 * plus ten days). Provider look-back padding is applied afterwards and is not
 * part of the cap.
 */
export function validateHistoryRange(
  fromInput: string,
  toInput: string,
  now = new Date(),
) {
  if (!parseDayKey(fromInput) || !parseDayKey(toInput)) {
    throw new MarketDataError('Data inválida');
  }
  if (fromInput > toInput) throw new MarketDataError('Período inválido');
  if (toInput > todayKeyInSaoPaulo(now)) {
    throw new MarketDataError('Data futura não permitida');
  }
  if (diffDays(toInput, fromInput) + 1 > MAX_HISTORY_RANGE_DAYS) {
    throw new MarketDataError('O período máximo é de 10 anos e 10 dias');
  }
  return { from: dayKeyToDate(fromInput), to: dayKeyToDate(toInput) };
}

/** Last day that is fully over in São Paulo (yesterday). */
export function lastCompletedDayKey(now = new Date()): DayKey {
  return addDaysToKey(todayKeyInSaoPaulo(now), -1);
}

/** Saturday/Sunday roll back to Friday. Holidays are unknown here. */
export function lastWeekdayOnOrBefore(key: DayKey): DayKey {
  let current = key;
  while (weekdayOfKey(current) === 0 || weekdayOfKey(current) === 6) {
    current = addDaysToKey(current, -1);
  }
  return current;
}

/**
 * Drops the still-open day (today in São Paulo and later): an intraday candle
 * must never be stored as if it were final.
 */
export function completedPointsOnly(
  points: MarketPoint[],
  now = new Date(),
): MarketPoint[] {
  const lastDone = lastCompletedDayKey(now);
  return points.filter((point) => point.date <= lastDone);
}

/**
 * A cached daily series is fresh when it starts near `from` and reaches the
 * last COMPLETED trading day inside the range. `businessDaysOnly` series (USD,
 * CDI) skip weekends when deciding which day to expect.
 */
export function isFreshHistory(
  points: MarketPoint[],
  fromKey: DayKey,
  toKey: DayKey,
  options: { now?: Date; businessDaysOnly?: boolean } = {},
) {
  let expected = toKey < lastCompletedDayKey(options.now)
    ? toKey
    : lastCompletedDayKey(options.now);
  if (options.businessDaysOnly) expected = lastWeekdayOnOrBefore(expected);
  // Nothing in the range has finished yet: an empty series is complete.
  if (expected < fromKey) return true;
  if (points.length === 0) return false;

  const first = points[0].date;
  const last = points[points.length - 1].date;
  return last >= expected && first <= addDaysToKey(fromKey, 4);
}

export function dedupePoints(points: MarketPoint[]): MarketPoint[] {
  const map = new Map<string, string>();
  for (const point of points) map.set(point.date, point.value);
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, value }));
}

/** Copy so callers can never mutate a result shared through singleFlight. */
export function cloneSeries(series: MarketSeries): MarketSeries {
  return {
    provider: series.provider,
    stale: series.stale,
    points: series.points.map((point) => ({ ...point })),
  };
}

/** Value of the latest day on or before `day` (map keys must be sorted). */
export function valueOnOrBefore(
  byDay: Map<string, Prisma.Decimal>,
  day: string,
): Prisma.Decimal | undefined {
  const exact = byDay.get(day);
  if (exact) return exact;
  let found: Prisma.Decimal | undefined;
  for (const key of byDay.keys()) {
    if (key > day) break;
    found = byDay.get(key);
  }
  return found;
}

/**
 * Walks a sorted series with a moving pointer: O(1) amortised lookups when
 * days are asked for in ascending order (used by the patrimony timeline).
 */
export function createPointCursor<T extends { date: string }>(points: T[]) {
  let index = -1;
  return {
    /** Latest point with date <= day, or null. `day` must not go backwards. */
    at(day: string): T | null {
      while (index + 1 < points.length && points[index + 1].date <= day) {
        index += 1;
      }
      return index >= 0 ? points[index] : null;
    },
  };
}
