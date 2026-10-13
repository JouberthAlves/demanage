import { Prisma } from '@/generated/prisma/client';

import { MarketDataError, type MarketPoint } from '../types';

/** Banco Central SGS. Pure URL builders and parsers. */

export type BcbRow = { data?: string; valor?: string };

/** SGS series ids used by the app. */
export const BCB_SERIES = { USD_BRL: 1, CDI_DAILY: 12 } as const;

function ddmmyyyy(key: string) {
  const [year, month, day] = key.split('-');
  return `${day}/${month}/${year}`;
}

export function bcbRangeUrl(series: number, fromKey: string, toKey: string) {
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados?formato=json&dataInicial=${ddmmyyyy(fromKey)}&dataFinal=${ddmmyyyy(toKey)}`;
}

export function bcbLatestUrl(series: number, count: number) {
  return `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${series}/dados/ultimos/${count}?formato=json`;
}

/** Body of a BCB response -> rows ([] for the API's 404-as-JSON). */
export function parseBcbBody(
  body: BcbRow[] | { erro?: { statusCode?: number } } | null,
): BcbRow[] {
  if (body == null) return [];
  if (Array.isArray(body)) return body;
  if (body.erro?.statusCode === 404) return [];
  throw new MarketDataError('Resposta do BCB inválida');
}

export function parseBcbRows(rows: BcbRow[]): MarketPoint[] {
  const points: MarketPoint[] = [];
  for (const row of rows) {
    if (!row.data || row.valor == null) continue;
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row.data);
    if (!match) continue;
    let value: Prisma.Decimal;
    try {
      value = new Prisma.Decimal(String(row.valor).replace(',', '.'));
    } catch {
      continue;
    }
    if (!value.isFinite() || value.lt(0)) continue;
    points.push({
      date: `${match[3]}-${match[2]}-${match[1]}`,
      value: value.toFixed(),
    });
  }
  return points;
}
