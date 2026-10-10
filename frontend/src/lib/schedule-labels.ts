import { MONTH_LABELS } from '@/data/labels';

/** "2026-10-05" -> "05/10/2026" */
export function formatDayKeyBr(day: string | null | undefined) {
  return day ? day.slice(0, 10).split('-').reverse().join('/') : null;
}

/** "Dia 05 · Outubro" for a recurring schedule, or null without a day. */
export function formatScheduleDay(
  day: number | null | undefined,
  startsAt: string | null | undefined,
) {
  if (!day) return null;
  const month = startsAt
    ? (MONTH_LABELS[Number(startsAt.slice(5, 7))] ?? '')
    : '';
  return `Dia ${String(day).padStart(2, '0')}${month ? ` · ${month}` : ''}`;
}
