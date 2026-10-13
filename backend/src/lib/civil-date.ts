/**
 * Single source of truth for civil (calendar) dates.
 *
 * A "day key" is the string YYYY-MM-DD. Date-only values are stored in the
 * database as JS Dates with ONE of two conventions; both are explicit here:
 *   - 'noon'     : Date.UTC(y, m, d, 12). Default for ledger dates (never
 *                  changes civil day in UTC or America/Sao_Paulo).
 *   - 'midnight' : Date.UTC(y, m, d). Used by recurring-schedule fields
 *                  (entry/expense startsAt, endsAt) that were stored this way.
 * Reading either back is the same: use the UTC components (dayKeyOfDate).
 */
export type DayKey = string;
export type DateConvention = 'noon' | 'midnight';

export const BILLING_TIMEZONE = 'America/Sao_Paulo';
const MS_PER_DAY = 86_400_000;
const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, width = 2) {
  return String(value).padStart(width, '0');
}

export function formatDayKey(year: number, monthIndex: number, day: number) {
  return `${pad(year, 4)}-${pad(monthIndex + 1)}-${pad(day)}`;
}

export function lastDayOfMonth(year: number, monthIndex: number) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Day clamped to the length of the month (31 -> 28/29/30). */
export function clampDayToMonth(year: number, monthIndex: number, day: number) {
  return Math.min(Math.max(day, 1), lastDayOfMonth(year, monthIndex));
}

/** Strict YYYY-MM-DD parse. Returns null for anything else, incl. 2026-02-30. */
export function parseDayKey(
  value: unknown,
): { year: number; monthIndex: number; day: number } | null {
  if (typeof value !== 'string') return null;
  const match = DAY_KEY_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (monthIndex < 0 || monthIndex > 11 || day < 1) return null;
  if (day > lastDayOfMonth(year, monthIndex)) return null;
  return { year, monthIndex, day };
}

export function isValidDayKey(value: unknown): boolean {
  return parseDayKey(value) !== null;
}

export function dayKeyToDate(
  key: DayKey,
  convention: DateConvention = 'noon',
): Date {
  const parts = parseDayKey(key);
  if (!parts) throw new RangeError(`Invalid day key: ${key}`);
  return new Date(
    Date.UTC(
      parts.year,
      parts.monthIndex,
      parts.day,
      convention === 'noon' ? 12 : 0,
    ),
  );
}

/**
 * The one strict date-only parser. Returns null for anything that is not a
 * real calendar date in YYYY-MM-DD form (2026-02-30 is rejected).
 */
export function parseCivilDate(
  value: unknown,
  convention: DateConvention = 'noon',
): Date | null {
  if (!parseDayKey(value)) return null;
  return dayKeyToDate(value as string, convention);
}

/** Day key from the UTC components of a stored date-only Date. */
export function dayKeyOfDate(date: Date): DayKey {
  return formatDayKey(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

/** Instant -> civil day in America/Sao_Paulo. */
export function dayKeyInSaoPaulo(instant: Date): DayKey {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BILLING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function todayKeyInSaoPaulo(now = new Date()): DayKey {
  return dayKeyInSaoPaulo(now);
}

/** Today's civil date in Sao Paulo as a noon-UTC Date. */
export function todayInSaoPaulo(now = new Date()): Date {
  return dayKeyToDate(dayKeyInSaoPaulo(now), 'noon');
}

export function compareDayKeys(a: DayKey, b: DayKey) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Days since 1970-01-01 for a day key (integer, timezone free). */
export function dayNumber(key: DayKey): number {
  const parts = parseDayKey(key);
  if (!parts) throw new RangeError(`Invalid day key: ${key}`);
  return Math.round(
    Date.UTC(parts.year, parts.monthIndex, parts.day) / MS_PER_DAY,
  );
}

export function dayKeyFromNumber(dayNum: number): DayKey {
  return dayKeyOfDate(new Date(dayNum * MS_PER_DAY));
}

export function addDaysToKey(key: DayKey, days: number): DayKey {
  return dayKeyFromNumber(dayNumber(key) + days);
}

/** a - b in whole days. */
export function diffDays(a: DayKey, b: DayKey) {
  return dayNumber(a) - dayNumber(b);
}

/** Date + n days, keeping the time component (UTC arithmetic). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOfKey(key: DayKey): number {
  return new Date(dayNumber(key) * MS_PER_DAY).getUTCDay();
}

export function monthKey(value: Date | DayKey): string {
  const key = typeof value === 'string' ? value : dayKeyOfDate(value);
  return key.slice(0, 7);
}

/** First and last day (keys and noon-UTC Dates) of a month. */
export function monthBounds(year: number, monthIndex: number) {
  const lastDay = lastDayOfMonth(year, monthIndex);
  const startKey = formatDayKey(year, monthIndex, 1);
  const endKey = formatDayKey(year, monthIndex, lastDay);
  return {
    startKey,
    endKey,
    start: dayKeyToDate(startKey, 'noon'),
    end: dayKeyToDate(endKey, 'noon'),
    lastDay,
  };
}

/**
 * Same day-of-month `months` later, clamped to month end
 * (Jan 31 + 1 month = Feb 28/29).
 */
export function addMonthsClamped(key: DayKey, months: number): DayKey {
  const parts = parseDayKey(key);
  if (!parts) throw new RangeError(`Invalid day key: ${key}`);
  const total = parts.year * 12 + parts.monthIndex + months;
  const year = Math.floor(total / 12);
  const monthIndex = total - year * 12;
  return formatDayKey(
    year,
    monthIndex,
    clampDayToMonth(year, monthIndex, parts.day),
  );
}
