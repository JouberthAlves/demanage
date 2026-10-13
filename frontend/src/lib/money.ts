/**
 * Integer-cent money helpers. They mirror backend lib/money.ts
 * (allocateByPercent): every part but the last is HALF_UP(total * percent /
 * 100) to cents and the last part is the remainder, so parts always sum to the
 * total. Only integer arithmetic is used after the amount enters cents.
 */

export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** HALF_UP(totalCents * percent / 100) for non-negative integer inputs. */
export function percentOfCents(totalCents: number, percent: number): number {
  return Math.floor((totalCents * percent + 50) / 100);
}

/**
 * Splits `totalCents` by integer percents; the last part takes the remainder
 * (same order as the backend: the first part is the first percent).
 */
export function allocateCentsByPercent(
  totalCents: number,
  percents: number[],
): number[] {
  if (percents.length === 0) return [];
  const parts: number[] = [];
  let allocated = 0;
  for (let index = 0; index < percents.length - 1; index += 1) {
    const part = percentOfCents(totalCents, percents[index] ?? 0);
    parts.push(part);
    allocated += part;
  }
  parts.push(totalCents - allocated);
  return parts;
}
