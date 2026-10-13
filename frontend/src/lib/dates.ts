/**
 * Civil-calendar helpers for the financial domain.
 *
 * Convention: every `now: Date` passed around the finance libs is a real
 * instant. Whenever a calendar day or month is needed, it is derived in the
 * São Paulo timezone, which is the business calendar the backend also uses.
 * Calendar days travel as `DayKey` strings (YYYY-MM-DD), which compare
 * correctly with plain string comparison.
 */

export const FINANCIAL_TIMEZONE = 'America/Sao_Paulo';

/** YYYY-MM-DD */
export type DayKey = string;
/** YYYY-MM */
export type MonthKey = string;

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: FINANCIAL_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

/** Calendar day in São Paulo for an instant. */
export function dayKeyOf(instant: Date | string | number): DayKey | null {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  const parts = dayFormatter.formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Calendar month in São Paulo for an instant. */
export function monthKeyOf(instant: Date | string | number): MonthKey | null {
  return dayKeyOf(instant)?.slice(0, 7) ?? null;
}

export function todayKey(now: Date = new Date()): DayKey {
  return dayKeyOf(now) ?? '';
}

export function currentMonthKey(now: Date = new Date()): MonthKey {
  return todayKey(now).slice(0, 7);
}

export type CivilDay = { year: number; month: number; day: number };

/** Strictly parses YYYY-MM-DD (rejects 2026-02-30). */
export function parseDayKey(value: string | null | undefined): CivilDay | null {
  if (!value) return null;
  const match = DAY_KEY_PATTERN.exec(value.slice(0, 10));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

export function parseMonthKey(
  value: string | null | undefined,
): { year: number; month: number } | null {
  if (!value) return null;
  const match = MONTH_KEY_PATTERN.exec(value.slice(0, 7));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function formatDayKey({ year, month, day }: CivilDay): DayKey {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function formatMonthKey(year: number, month: number): MonthKey {
  return `${year}-${pad2(month)}`;
}

/** month is 1-12 */
export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Clamps a day-of-month into the given month (31 → 28/29/30). */
export function clampedDayKey(year: number, month: number, day: number) {
  const safeDay = Math.min(Math.max(day, 1), daysInMonth(year, month));
  return formatDayKey({ year, month, day: safeDay });
}

/** Adds whole months to a month key (handles year rollover). */
export function addMonths(key: MonthKey, delta: number): MonthKey {
  const parsed = parseMonthKey(key);
  if (!parsed) return key;
  const index = parsed.year * 12 + (parsed.month - 1) + delta;
  return formatMonthKey(Math.floor(index / 12), (index % 12) + 1);
}

/** Adds whole days to a day key. */
export function addDays(key: DayKey, delta: number): DayKey {
  const parsed = parseDayKey(key);
  if (!parsed) return key;
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  date.setUTCDate(date.getUTCDate() + delta);
  return formatDayKey({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

/**
 * Date whose *local* fields equal the civil day. Only for UI widgets
 * (calendars, Intl formatting) that operate on local Date fields.
 */
export function localDateFromDayKey(key: DayKey): Date | null {
  const parsed = parseDayKey(key);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month - 1, parsed.day);
}

/** Inverse of localDateFromDayKey: reads the local fields of a UI Date. */
export function dayKeyFromLocalDate(date: Date): DayKey {
  return formatDayKey({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

/**
 * A stable instant inside the given São Paulo day (noon, UTC-3). Used to turn
 * the store's calendar day into the `now` the finance libs expect.
 */
export function instantForDayKey(key: DayKey): Date {
  return new Date(`${key}T12:00:00-03:00`);
}
