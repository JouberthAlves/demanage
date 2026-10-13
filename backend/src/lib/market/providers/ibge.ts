import { Prisma } from '@/generated/prisma/client';
import { dayKeyOfDate } from '@/lib/civil-date';

import type { MarketPoint } from '../types';

/** IBGE SIDRA IPCA (table 1737). Pure builders and parsers. */

export function sidraIpcaUrl(period: string) {
  return `https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/${period}`;
}

/** SIDRA reference-month range (YYYYMM-YYYYMM) that can affect [from, to]. */
export function ipcaPeriodRange(from: Date, to: Date) {
  const startReference = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth() - (from.getUTCDate() <= 15 ? 1 : 0),
      1,
      12,
    ),
  );
  const endReference = new Date(
    Date.UTC(
      to.getUTCFullYear(),
      to.getUTCMonth() - (to.getUTCDate() >= 15 ? 1 : 2),
      1,
      12,
    ),
  );
  if (startReference > endReference) return null;
  const yearMonth = (date: Date) =>
    date.toISOString().slice(0, 7).replace('-', '');
  return `${yearMonth(startReference)}-${yearMonth(endReference)}`;
}

/**
 * SIDRA rows -> index points. Conservative against look-ahead: an index only
 * takes effect on the 15th of the month after its reference month.
 */
export function parseSidraIpca(
  rows: Array<Record<string, string>>,
  fromKey: string,
  toKey: string,
  todayKey: string,
): MarketPoint[] {
  const points: MarketPoint[] = [];
  for (const row of rows.slice(1)) {
    const referencePeriod = Object.values(row).find((value) =>
      /^\d{6}$/.test(value),
    );
    const rawValue = row.V;
    if (!referencePeriod || !rawValue || rawValue === '...') continue;
    const value = Number(rawValue.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) continue;
    const year = Number(referencePeriod.slice(0, 4));
    const month = Number(referencePeriod.slice(4, 6));
    if (month < 1 || month > 12) continue;
    // `month` is the 1-based reference month, so used as a 0-based index it
    // is the FOLLOWING month (Date.UTC rolls 12 into January).
    const key = dayKeyOfDate(new Date(Date.UTC(year, month, 15, 12)));
    if (key > todayKey || key < fromKey || key > toKey) continue;
    points.push({
      date: key,
      value: new Prisma.Decimal(rawValue.replace(',', '.')).toFixed(),
    });
  }
  return points;
}
