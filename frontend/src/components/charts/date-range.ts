import { addDays, todayKey } from '@/lib/dates';

export type DateRangePreset = { days: number; label: string };

export const DEFAULT_RANGE_PRESETS: DateRangePreset[] = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '3m' },
  { days: 365, label: '1a' },
];

/** Range ending today (São Paulo civil day) and starting `days` earlier. */
export function presetRange(days: number, now: Date = new Date()) {
  const to = todayKey(now);
  return { from: addDays(to, -days), to };
}
