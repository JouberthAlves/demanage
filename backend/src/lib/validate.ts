const EXPENSE_CATEGORIES = new Set([
  'assinatura',
  'parcela',
  'divida',
  'outro',
  'cofrinho',
]);

const ENTRY_TYPES = new Set(['salario', 'freelance', 'outro']);

const FREQUENCIES = new Set(['mensal', 'semanal', 'unica']);

/** Prisma Decimal(12, 2) — máximo absoluto < 10^10. */
export const MAX_MONEY_AMOUNT = 9_999_999_999.99;

export function parsePositiveAmount(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const rounded = Math.round(amount * 100) / 100;
  if (rounded > MAX_MONEY_AMOUNT) {
    return null;
  }
  return rounded;
}

export function positiveAmountError(value: unknown): string {
  const amount = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(amount) && amount > MAX_MONEY_AMOUNT) {
    return 'Valor máximo é R$ 9.999.999.999,99';
  }
  return 'Valor deve ser maior que zero';
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

export function parseUniqueDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
