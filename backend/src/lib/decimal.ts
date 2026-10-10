import { Prisma } from '@/generated/prisma/client';
import { dayKeyOfDate } from '@/lib/civil-date';
import { toMoney } from '@/lib/money';

export type DecimalLike = Prisma.Decimal | string | number;

export function decimal(value: DecimalLike) {
  return new Prisma.Decimal(value);
}

export const ZERO = decimal(0);
export const ONE_HUNDRED = decimal(100);

/** Alias of money.toMoney (HALF_UP to cents). */
export function money(value: DecimalLike) {
  return toMoney(value);
}

export function decimalString(value: DecimalLike, places?: number) {
  const parsed = decimal(value);
  return places == null ? parsed.toString() : parsed.toFixed(places);
}

/**
 * Normalises an instant (or ISO string) to its UTC calendar day at 12:00 UTC
 * (the 'noon' storage convention, see civil-date.ts).
 */
export function dateOnlyUtc(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12),
  );
}

export function dateKey(value: Date | string) {
  return dayKeyOfDate(dateOnlyUtc(value));
}
