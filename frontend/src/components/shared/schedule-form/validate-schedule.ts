import { todayKey } from '@/lib/dates';
import { normalizeClosingDayInput } from '@/lib/format';
import { buildScheduleStartsAt, formatStartsAtPreview } from '@/lib/schedule';

/** A validation failure tied to the DOM id of the offending field. */
export type FormFieldError = { fieldId: string; message: string };

/** Day-of-month / month / end date inputs shared by expenses and incomes. */
export type ScheduleFieldValues = {
  /** Day of month as typed ("05"). */
  day: string;
  /** Month number 1-12 as a string. */
  month: string;
  /** YYYY-MM-DD or ''. */
  endsAt: string;
};

export type ScheduleIds = { day: string; month: string; endsAt: string };

export type ScheduleMessages = {
  day: string;
  month: string;
  endsAt: string;
};

type ScheduleContext = { now: Date; previousStartsAt?: string | null };

export function isRecurringFrequency(frequency: string) {
  return frequency === 'mensal' || frequency === 'semanal';
}

/** Current São Paulo month as "1".."12". */
export function currentMonthValue(now: Date) {
  return String(Number(todayKey(now).slice(5, 7)));
}

/** Month of a stored startsAt as "1".."12", falling back to the current one. */
export function monthValueFromStartsAt(
  startsAt: string | null | undefined,
  now: Date,
) {
  return startsAt
    ? String(Number(startsAt.slice(5, 7)))
    : currentMonthValue(now);
}

/** Stored day of month as a two digit string ("05" when absent). */
export function dayValueFromStored(day: number | null | undefined) {
  return day ? String(day).padStart(2, '0') : '05';
}

/** Schedule inputs after the frequency changes (one-off items have no day). */
export function scheduleValuesForFrequency(
  current: ScheduleFieldValues,
  frequency: string,
  now: Date,
): ScheduleFieldValues {
  const oneOff = frequency === 'unica';
  return {
    day: oneOff ? '' : current.day || '05',
    month: oneOff ? current.month : current.month || currentMonthValue(now),
    endsAt: oneOff ? '' : current.endsAt,
  };
}

/** Parsed day and first occurrence, or null while day / month are invalid. */
export function resolveSchedule(
  values: Pick<ScheduleFieldValues, 'day' | 'month'>,
  { now, previousStartsAt }: ScheduleContext,
): { day: number; startsAt: string } | null {
  const normalized = normalizeClosingDayInput(values.day);
  const day = normalized ? Number(normalized) : Number.NaN;
  const month = Number(values.month);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return {
    day,
    startsAt: buildScheduleStartsAt(day, month, { now, previousStartsAt }),
  };
}

/** "05 de Outubro de 2026" for the typed day / month, or null when invalid. */
export function schedulePreview(
  values: Pick<ScheduleFieldValues, 'day' | 'month'>,
  context: ScheduleContext,
) {
  const resolved = resolveSchedule(values, context);
  return resolved ? formatStartsAtPreview(resolved.startsAt) : null;
}

export type ScheduleValidation =
  | { ok: true; day: number; startsAt: string }
  | { ok: false; error: FormFieldError };

/** Validates the recurring schedule inputs of a form. */
export function validateSchedule(
  values: ScheduleFieldValues,
  ids: ScheduleIds,
  messages: ScheduleMessages,
  context: ScheduleContext,
): ScheduleValidation {
  const normalized = normalizeClosingDayInput(values.day);
  const day = normalized ? Number(normalized) : Number.NaN;
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    return { ok: false, error: { fieldId: ids.day, message: messages.day } };
  }
  const month = Number(values.month);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return {
      ok: false,
      error: { fieldId: ids.month, message: messages.month },
    };
  }
  const startsAt = buildScheduleStartsAt(day, month, context);
  if (values.endsAt && values.endsAt < startsAt) {
    return {
      ok: false,
      error: { fieldId: ids.endsAt, message: messages.endsAt },
    };
  }
  return { ok: true, day, startsAt };
}
