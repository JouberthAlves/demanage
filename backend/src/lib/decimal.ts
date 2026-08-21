import { Prisma } from '@prisma/client';

export type DecimalLike = Prisma.Decimal | string | number;

export function decimal(value: DecimalLike) {
  return new Prisma.Decimal(value);
}

export const ZERO = decimal(0);
export const ONE_HUNDRED = decimal(100);

export function money(value: DecimalLike) {
  return decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function decimalString(value: DecimalLike, places?: number) {
  const parsed = decimal(value);
  return places == null ? parsed.toString() : parsed.toFixed(places);
}

export function dateOnlyUtc(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12),
  );
}

export function dateKey(value: Date | string) {
  return dateOnlyUtc(value).toISOString().slice(0, 10);
}
