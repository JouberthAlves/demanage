export function parseReceiveDay(value: unknown): number | null {
  if (value == null || value === '') return null;
  const day = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error('INVALID_RECEIVE_DAY');
  }
  return day;
}

export function parseDateOnly(
  value: unknown,
  errorCode = 'INVALID_DATE',
): Date | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error(errorCode);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(errorCode);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(errorCode);
  }
  return date;
}

export function parseEndsAt(value: unknown): Date | null {
  try {
    return parseDateOnly(value, 'INVALID_ENDS_AT');
  } catch {
    throw new Error('INVALID_ENDS_AT');
  }
}

export function parseStartsAt(value: unknown): Date | null {
  try {
    return parseDateOnly(value, 'INVALID_STARTS_AT');
  } catch {
    throw new Error('INVALID_STARTS_AT');
  }
}
