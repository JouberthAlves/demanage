import { parseCivilDate } from '@/lib/civil-date';

const EXPENSE_CATEGORIES = new Set([
  'assinatura',
  'parcela',
  'divida',
  'outro',
  'cofrinho',
  'investimento',
]);

const ENTRY_TYPES = new Set(['salario', 'freelance', 'outro']);
const FREQUENCIES = new Set(['mensal', 'semanal', 'unica']);

/** Prisma Decimal(12, 2) — máximo absoluto < 10^10. */
export const MAX_MONEY_AMOUNT = 9_999_999_999.99;

export function parseMoneyAmount(
  value: unknown,
  allowZero = false,
): number | null {
  const raw =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : '';
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const integerDigits = raw.split('.')[0].replace(/^0+/, '').length;
  if (integerDigits > 10) return null;

  const amount = Number(raw);
  if (
    !Number.isFinite(amount) ||
    amount > MAX_MONEY_AMOUNT ||
    (allowZero ? amount < 0 : amount <= 0)
  ) {
    return null;
  }
  return amount;
}

export function parsePositiveAmount(value: unknown): number | null {
  return parseMoneyAmount(value);
}

export function positiveAmountError(value: unknown): string {
  const amount = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(amount) && amount > MAX_MONEY_AMOUNT) {
    return 'Valor máximo é R$ 9.999.999.999,99';
  }
  return 'Valor deve ser positivo e ter no máximo duas casas decimais';
}

export function parseOptionalCardLimit(value: unknown): {
  value: number | null | undefined;
  error: string | null;
} {
  if (value === undefined) return { value: undefined, error: null };
  if (value === null || value === '') return { value: null, error: null };
  const limit = parsePositiveAmount(value);
  return limit == null
    ? { value: null, error: positiveAmountError(value) }
    : { value: limit, error: null };
}

export function isValidExpenseCategory(value: unknown): boolean {
  return typeof value === 'string' && EXPENSE_CATEGORIES.has(value);
}

export function isValidEntryType(value: unknown): boolean {
  return typeof value === 'string' && ENTRY_TYPES.has(value);
}

export function isValidFrequency(value: unknown): boolean {
  return typeof value === 'string' && FREQUENCIES.has(value);
}

/**
 * Strict YYYY-MM-DD parser for one-off dates. Storage convention: NOON UTC.
 * Delegates to civil-date.
 */
export function parseUniqueDate(value: unknown): Date | null {
  return parseCivilDate(value, 'noon');
}
