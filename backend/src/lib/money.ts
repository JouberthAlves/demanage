import { Prisma } from '@/generated/prisma/client';

/**
 * Cent-exact money helpers built on Prisma.Decimal (decimal.js).
 * Everything here is pure (no database import).
 */
export type MoneyInput = Prisma.Decimal | string | number;

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

export function toMoney(value: MoneyInput): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2, HALF_UP);
}

/** Exact sum of the values, rounded once (HALF_UP) to cents. */
export function sumMoney(values: Iterable<MoneyInput>): Prisma.Decimal {
  let total = new Prisma.Decimal(0);
  for (const value of values) total = total.plus(value);
  return toMoney(total);
}

/**
 * Splits `total` (rounded to cents first) by percentages. Every part but the
 * last is `total * percent / 100` rounded HALF_UP to cents; the last part is
 * the remainder, so the parts always sum to the total to the cent.
 */
export function allocateByPercent(
  total: MoneyInput,
  percents: MoneyInput[],
): Prisma.Decimal[] {
  if (percents.length === 0) return [];
  const exactTotal = toMoney(total);
  const parts: Prisma.Decimal[] = [];
  let allocated = new Prisma.Decimal(0);
  for (let index = 0; index < percents.length - 1; index += 1) {
    const part = toMoney(exactTotal.mul(percents[index]).div(100));
    parts.push(part);
    allocated = allocated.plus(part);
  }
  parts.push(exactTotal.minus(allocated));
  return parts;
}

/**
 * Plain (never exponent) string for a decimal. Prisma.Decimal#toString()
 * emits "1e-12" for tiny values, which must not leak into API payloads.
 */
export function plainDecimal(value: MoneyInput): string {
  return new Prisma.Decimal(value).toFixed();
}
