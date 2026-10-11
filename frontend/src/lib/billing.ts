import type { Card, ExpenseFrequency } from '@/types/finance';

/** Normal-cycle fallback (older backends / unknown card). */
export const DEFAULT_MAX_CHARGES_PER_CYCLE: Record<ExpenseFrequency, number> = {
  unica: 1,
  mensal: 1,
  semanal: 5,
};

/**
 * Most times an expense with this frequency can charge `card` inside its
 * current open billing cycle. The backend computes it (card serialization) so
 * a cycle longer than a month is accounted for; the card limit is checked
 * against share x this value.
 */
export function maxChargesPerCycle(
  card: Pick<Card, 'maxChargesPerCycle'>,
  frequency: ExpenseFrequency,
): number {
  return (
    card.maxChargesPerCycle?.[frequency] ??
    DEFAULT_MAX_CHARGES_PER_CYCLE[frequency]
  );
}
