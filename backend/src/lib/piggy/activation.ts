import { addDaysToKey, dayKeyToDate, todayKeyInSaoPaulo } from '@/lib/civil-date';

/** Pure "feature switched on" rules for piggy banks. DB side: services/piggy-banks.ts. */

/**
 * autoDebitEnabledAt after an update: null while off; kept while it stays on
 * (null stays null for legacy rows, so their history is not cut); reset to
 * `now` on every off -> on transition, so re-enabling never back-fills.
 */
export function nextAutoDebitEnabledAt(
  existing: { autoDebit: boolean; autoDebitEnabledAt: Date | null },
  autoDebit: boolean,
  now = new Date(),
): Date | null {
  if (!autoDebit) return null;
  return existing.autoDebit ? existing.autoDebitEnabledAt : now;
}

/**
 * When yield turns effective (disabled -> enabled, or CDI 0 -> >0) interest
 * must start accruing on that day, not at the bank's creation or at the old
 * high-water mark. Returns the interestAccruedThrough to store (the São Paulo
 * "yesterday", noon-UTC like every ledger date), or null to leave it alone.
 */
export function interestAccruedThroughOnActivation(
  wasYielding: boolean,
  willYield: boolean,
  now = new Date(),
): Date | null {
  if (wasYielding || !willYield) return null;
  return dayKeyToDate(addDaysToKey(todayKeyInSaoPaulo(now), -1));
}
