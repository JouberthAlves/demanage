import {
  addDaysToKey,
  dayKeyOfDate,
  dayKeyToDate,
  todayKeyInSaoPaulo,
} from '@/lib/civil-date';

import { cachedRangeWithFetchTime, storePoints } from './cache';
import { singleFlight } from './flight';
import { historyWithCache } from './history';
import { getJson } from './http';
import {
  BCB_SERIES,
  bcbLatestUrl,
  bcbRangeUrl,
  type BcbRow,
  parseBcbBody,
  parseBcbRows,
} from './providers/bcb';
import {
  ipcaPeriodRange,
  parseSidraIpca,
  sidraIpcaUrl,
} from './providers/ibge';
import { cloneSeries, dedupePoints, validateHistoryRange } from './series';
import {
  type HistoryOptions,
  IPCA_CACHE_TTL_MS,
  MarketDataError,
  type MarketPoint,
  type MarketSeries,
  PROVIDERS,
} from './types';

// -------------------------------------------------------------------- CDI

export async function getCdiHistory(
  fromInput: string,
  toInput: string,
  options: HistoryOptions = {},
): Promise<MarketSeries> {
  validateHistoryRange(fromInput, toInput);
  const fromKey = addDaysToKey(fromInput, -(options.lookbackDays ?? 0));
  const toKey = toInput;
  const flightKey = `cdi-history:${fromKey}:${toKey}`;
  const provider = PROVIDERS.CDI;
  const key = 'CDI_DAILY_PERCENT';

  const series = await singleFlight(flightKey, () =>
    historyWithCache({
      flightKey,
      cacheProvider: provider,
      cacheKey: key,
      fromKey,
      toKey,
      businessDaysOnly: true,
      fetchLive: async () => {
        const points: MarketPoint[] = [];
        // The provider needs a short look-back to return a first row even when
        // `from` falls on a weekend or holiday; it is trimmed below.
        let cursor = addDaysToKey(fromKey, -14);
        while (cursor <= toKey) {
          // SGS limits one request to ten years of daily data.
          const maxEnd = dayKeyOfDate(
            new Date(
              Date.UTC(
                Number(cursor.slice(0, 4)) + 9,
                Number(cursor.slice(5, 7)) - 1,
                Number(cursor.slice(8, 10)),
                12,
              ),
            ),
          );
          const chunkEnd = maxEnd < toKey ? maxEnd : toKey;
          const body = await getJson<
            BcbRow[] | { erro?: { statusCode?: number } } | null
          >(bcbRangeUrl(BCB_SERIES.CDI_DAILY, cursor, chunkEnd), {
            onNotFound: null,
          });
          points.push(...parseBcbRows(parseBcbBody(body)));
          cursor = addDaysToKey(chunkEnd, 1);
        }
        let deduped = dedupePoints(points);
        if (deduped.length === 0) {
          const latest = await getJson<BcbRow[] | null>(
            bcbLatestUrl(BCB_SERIES.CDI_DAILY, 30),
            { onNotFound: null },
          );
          deduped = dedupePoints(parseBcbRows(parseBcbBody(latest)));
        }
        if (deduped.length === 0) {
          throw new MarketDataError('Sem histórico CDI');
        }
        return { points: deduped, provider, stale: false };
      },
    }),
  );
  // The live path may include the 14-day provider look-back; return the range.
  const result = cloneSeries(series);
  result.points = result.points.filter(
    (point) => point.date >= fromKey && point.date <= toKey,
  );
  return result;
}

// ------------------------------------------------------------------- IPCA

export async function getIpcaHistory(
  fromInput: string,
  toInput: string,
  options: HistoryOptions = {},
): Promise<MarketSeries> {
  validateHistoryRange(fromInput, toInput);
  const fromKey = addDaysToKey(fromInput, -(options.lookbackDays ?? 0));
  const toKey = toInput;
  const from = dayKeyToDate(fromKey);
  const to = dayKeyToDate(toKey);
  const provider = PROVIDERS.IPCA;
  const key = 'IPCA_INDEX_EFFECTIVE';

  const series = await singleFlight(`ipca-history:${fromKey}:${toKey}`, async () => {
    const cachedRows = await cachedRangeWithFetchTime(
      provider,
      key,
      fromKey,
      toKey,
    );
    const cachedPoints = cachedRows.map(({ date, value }) => ({ date, value }));
    const now = Date.now();
    const cacheIsFresh =
      cachedRows.length > 0 &&
      cachedRows[0].date <= addDaysToKey(fromKey, 45) &&
      cachedRows[cachedRows.length - 1].date >= addDaysToKey(toKey, -45) &&
      cachedRows.every((row) => now - row.fetchedAt.getTime() < IPCA_CACHE_TTL_MS);
    if (cacheIsFresh) return { provider, stale: false, points: cachedPoints };

    const period = ipcaPeriodRange(from, to);
    try {
      if (!period) throw new MarketDataError('Sem histórico IPCA no período');
      const rows = await getJson<Array<Record<string, string>>>(
        sidraIpcaUrl(period),
        { timeoutMs: 10_000 },
      );
      const deduped = dedupePoints(
        parseSidraIpca(rows, fromKey, toKey, todayKeyInSaoPaulo()),
      );
      if (deduped.length === 0) {
        if (cachedPoints.length > 0) {
          return { provider, stale: true, points: cachedPoints };
        }
        throw new MarketDataError('Sem histórico IPCA no período');
      }
      await storePoints(provider, key, deduped, { touch: true });
      return { provider, stale: false, points: deduped };
    } catch (error) {
      if (cachedPoints.length === 0) throw error;
      return { provider, stale: true, points: cachedPoints };
    }
  });
  return cloneSeries(series);
}
