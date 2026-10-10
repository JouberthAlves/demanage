import { parseAbnt2Text } from '@/lib/abnt2';
import { parseMoneyAmount, positiveAmountError } from '@/lib/validate';

import { badRequest } from './errors';

/** Dia do mês (1-31). `undefined` → ausente; `null`/`''` → `null`. */
export function parseDayOfMonth(
  value: unknown,
  message: string,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const day =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d{1,2}$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(day) || day < 1 || day > 31) throw badRequest(message);
  return day;
}

/** `YYYY-MM-DD` estrito (rejeita 2026-02-30) → meia-noite UTC; senão `null`. */
export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Data civil opcional: `undefined` ausente, `null`/`''` → `null`, inválida → 400. */
export function parseOptionalIsoDate(
  value: unknown,
  message: string,
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const date = parseIsoDate(value);
  if (!date) throw badRequest(message);
  return date;
}

const ISO_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Validade de cartão. Aceita `YYYY-MM-DD` (vale até o fim desse dia em
 * São Paulo, 23:59:59.999 -03:00) ou um instante ISO-8601 completo com fuso
 * (formato legado do frontend). Datas de calendário inexistentes são rejeitadas.
 */
export function parseCardExpiry(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest('Validade inválida');

  const dateOnly = parseIsoDate(value);
  if (dateOnly) {
    return new Date(
      Date.UTC(
        dateOnly.getUTCFullYear(),
        dateOnly.getUTCMonth(),
        dateOnly.getUTCDate(),
        26,
        59,
        59,
        999,
      ),
    );
  }

  if (ISO_DATETIME.test(value) && parseIsoDate(value.slice(0, 10))) {
    const instant = new Date(value);
    if (!Number.isNaN(instant.getTime())) return instant;
  }
  throw badRequest('Validade inválida');
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `YYYY-MM` ou `null`. */
export function parseMonthKey(value: unknown): string | null {
  return typeof value === 'string' && MONTH_KEY.test(value) ? value : null;
}

/** Texto ABNT2 obrigatório; `message` quando ausente/vazio/não-string. */
export function parseRequiredText(
  value: unknown,
  maxLength: number,
  message: string,
): string {
  const text = parseAbnt2Text(value, { maxLength, required: true });
  if (!text) throw badRequest(message);
  return text;
}

/** Valor monetário positivo (ou zero com `allowZero`); 400 com mensagem padrão. */
export function parseAmount(
  value: unknown,
  options: { allowZero?: boolean; message?: string } = {},
): number {
  const amount = parseMoneyAmount(value, options.allowZero ?? false);
  if (amount == null) {
    throw badRequest(options.message ?? positiveAmountError(value));
  }
  return amount;
}

/** Valida pertencimento a um conjunto de valores permitidos. */
export function parseOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  message: string,
): T {
  if (
    typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
  ) {
    return value as T;
  }
  throw badRequest(message);
}

/** Id opcional de referência (tag/cartão): `undefined` ausente, `null`/`''` → `null`. */
export function parseOptionalId(
  value: unknown,
  message: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(message);
  return value;
}
