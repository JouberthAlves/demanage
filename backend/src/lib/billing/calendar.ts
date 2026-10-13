import {
  clampDayToMonth,
  compareDayKeys,
  type DayKey,
  dayKeyOfDate,
  dayKeyToDate,
  formatDayKey,
  parseDayKey,
} from '@/lib/civil-date';

/** Closing day clamped to the month (closing 31 in April -> April 30). */
export function closingDayKeyInMonth(
  year: number,
  monthIndex: number,
  closingDay: number,
): DayKey {
  return formatDayKey(
    year,
    monthIndex,
    clampDayToMonth(year, monthIndex, closingDay),
  );
}

export function formatPtBrDayKey(dayKey: DayKey) {
  const [year, month, day] = dayKey.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Closing day keys strictly after `afterKey`, up to `untilKey` (inclusive).
 * A safety bound of 1200 months protects against absurd ranges.
 */
export function listClosingDayKeys(
  closingDay: number,
  afterKey: DayKey,
  untilKey: DayKey,
): DayKey[] {
  const start = parseDayKey(afterKey);
  if (!start) throw new RangeError(`Invalid day key: ${afterKey}`);
  const keys: DayKey[] = [];
  let year = start.year;
  let month = start.monthIndex;

  for (let i = 0; i < 1200; i += 1) {
    const candidate = closingDayKeyInMonth(year, month, closingDay);
    if (compareDayKeys(candidate, untilKey) > 0) break;
    if (compareDayKeys(candidate, afterKey) > 0) keys.push(candidate);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return keys;
}

/** Closing dates (noon UTC) strictly after `after`, through `until` inclusive. */
export function listDueClosingDates(
  closingDay: number,
  after: Date,
  until: Date,
) {
  return listClosingDayKeys(
    closingDay,
    dayKeyOfDate(after),
    dayKeyOfDate(until),
  ).map((key) => dayKeyToDate(key, 'noon'));
}

/**
 * First closing day on or after `notBeforeKey` that is also strictly after
 * `afterKey` (the last invoiced day). Used to find the cycle that is open now.
 */
export function nextClosingOnOrAfter(
  closingDay: number,
  afterKey: DayKey,
  notBeforeKey: DayKey,
): DayKey {
  const start = parseDayKey(afterKey);
  if (!start) throw new RangeError(`Invalid day key: ${afterKey}`);
  let year = start.year;
  let month = start.monthIndex;
  for (let i = 0; i < 1200; i += 1) {
    const candidate = closingDayKeyInMonth(year, month, closingDay);
    if (
      compareDayKeys(candidate, afterKey) > 0 &&
      compareDayKeys(candidate, notBeforeKey) >= 0
    ) {
      return candidate;
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  throw new RangeError('No closing date found');
}
