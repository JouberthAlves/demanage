import { formatDayKeyBr, formatScheduleDay } from '@/lib/schedule-labels';
import type { Income } from '@/types/finance';

/** Expected date (one-off) or "Dia 05 · Outubro" (recurring); null if unknown. */
export function incomeReceiveLabel(income: Income) {
  if (income.frequency === 'unica') return formatDayKeyBr(income.date);
  return formatScheduleDay(income.receiveDay, income.startsAt);
}
