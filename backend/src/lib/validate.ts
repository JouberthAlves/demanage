const EXPENSE_CATEGORIES = new Set([
  'assinatura',
  'parcela',
  'divida',
  'outro',
]);

const ENTRY_TYPES = new Set(['salario', 'freelance', 'outro']);

const FREQUENCIES = new Set(['mensal', 'semanal', 'unica']);

export function parsePositiveAmount(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  return amount;
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
