import { MONTH_LABELS } from '@/data/labels';
import {
  clampedDayKey,
  type DayKey,
  parseDayKey,
  todayKey,
} from '@/lib/dates';

/**
 * Shared rules for recurring items (expenses debited / incomes received on a
 * fixed day of the month, bounded by optional startsAt / endsAt dates).
 */
export type ScheduleWindow = {
  startsAt?: string | null;
  endsAt?: string | null;
};

/** Day this month on which an item scheduled for `dayOfMonth` falls. */
export function scheduledDayThisMonth(
  dayOfMonth: number,
  now: Date = new Date(),
): DayKey {
  const today = parseDayKey(todayKey(now));
  if (!today) return todayKey(now);
  return clampedDayKey(today.year, today.month, dayOfMonth);
}

/** Whether `day` falls inside the item's [startsAt, endsAt] window. */
export function isWithinSchedule(day: DayKey, window: ScheduleWindow) {
  const startsAt = window.startsAt?.slice(0, 10);
  const endsAt = window.endsAt?.slice(0, 10);
  if (startsAt && day < startsAt) return false;
  if (endsAt && day > endsAt) return false;
  return true;
}

export function isSameMonth(day: DayKey, now: Date = new Date()) {
  return day.slice(0, 7) === todayKey(now).slice(0, 7);
}

/**
 * First occurrence (YYYY-MM-DD) for a schedule picked as day + month (1-12).
 *
 * New schedules start at the next occurrence of that month. When editing,
 * pass `previousStartsAt`: an unchanged day/month keeps the stored date, and
 * a changed one keeps its year, so saving an old schedule never moves it into
 * the future.
 */
export function buildScheduleStartsAt(
  day: number,
  month: number,
  options: { now?: Date; previousStartsAt?: string | null } = {},
) {
  const previous = parseDayKey(options.previousStartsAt);
  if (previous) {
    if (previous.month === month && previous.day === day) {
      return options.previousStartsAt!.slice(0, 10);
    }
    return clampedDayKey(previous.year, month, day);
  }

  const today = parseDayKey(todayKey(options.now));
  const currentYear = today?.year ?? new Date().getFullYear();
  const currentMonth = today?.month ?? 1;
  const year = month < currentMonth ? currentYear + 1 : currentYear;
  return clampedDayKey(year, month, day);
}

export function formatStartsAtPreview(startsAt: string) {
  const parsed = parseDayKey(startsAt);
  if (!parsed) return '';
  const day = String(parsed.day).padStart(2, '0');
  const month = MONTH_LABELS[parsed.month] ?? '';
  return `${day} de ${month} de ${parsed.year}`;
}
