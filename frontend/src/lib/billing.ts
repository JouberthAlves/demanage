import type { ExpenseFrequency } from '@/types/finance';

/**
 * Most times an expense with this frequency can charge a card inside one
 * billing cycle. Mirrors backend lib/billing (maxChargesPerCycle): keep both
 * in sync. The card limit is checked against share x this value.
 */
export function maxChargesPerCycle(frequency: ExpenseFrequency): number {
  return frequency === 'semanal' ? 5 : 1;
}
