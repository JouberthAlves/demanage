import { useMemo } from 'react';

import { instantForDayKey } from '@/lib/dates';
import { useCalendarStore } from '@/stores/calendar-store';

/**
 * `now` for the finance libs, stable for the whole São Paulo day and
 * refreshed when the calendar clock rolls over.
 */
export function useFinancialNow() {
  const dayKey = useCalendarStore((state) => state.dayKey);
  return useMemo(() => instantForDayKey(dayKey), [dayKey]);
}
