/**
 * pt-BR decimal input parsing. Users type "1.500,00", "1500,5", "0,20" or
 * (pasted) "0.20"; `replace(',', '.')` breaks the first form, so every free
 * decimal field goes through these helpers instead.
 *
 * Rules:
 * - a comma is always the decimal separator and dots before it are thousands
 *   separators ("1.500,00" -> 1500);
 * - without a comma, several dots are thousands separators only when each
 *   group after the first has exactly three digits ("1.500.000");
 * - a single dot followed by exactly three digits after a non-zero integer
 *   part reads as pt-BR thousands ("1.500" -> 1500); anything else is a
 *   decimal point ("0.20", "100.5", "0.500").
 */

/** Canonical dot-decimal string ("-1500.5") or null when not a number. */
export function normalizePtBrDecimal(value: string): string | null {
  const raw = value.replace(/\s+/g, '');
  if (!raw) return null;

  const negative = raw.startsWith('-');
  const body = negative ? raw.slice(1) : raw;
  if (!/^[\d.,]+$/.test(body)) return null;

  let integer: string;
  let fraction = '';

  const commaParts = body.split(',');
  if (commaParts.length > 2) return null;

  if (commaParts.length === 2) {
    const [intPart = '', fracPart = ''] = commaParts;
    if (!isThousandsGrouped(intPart)) return null;
    if (fracPart && !/^\d+$/.test(fracPart)) return null;
    integer = intPart.replace(/\./g, '');
    fraction = fracPart;
  } else {
    const dotParts = body.split('.');
    if (dotParts.length === 1) {
      integer = body;
    } else if (dotParts.length === 2) {
      const [intPart = '', fracPart = ''] = dotParts;
      const looksLikeThousands =
        /^[1-9]\d{0,2}$/.test(intPart) && /^\d{3}$/.test(fracPart);
      if (looksLikeThousands) {
        integer = intPart + fracPart;
      } else {
        if (!/^\d+$/.test(fracPart) && fracPart !== '') return null;
        integer = intPart;
        fraction = fracPart;
      }
    } else {
      if (!isThousandsGrouped(body)) return null;
      integer = body.replace(/\./g, '');
    }
  }

  if (!/^\d+$/.test(integer || '0')) return null;
  if (!integer && !fraction) return null;

  const cleanInteger = (integer || '0').replace(/^0+(?=\d)/, '');
  const result = fraction ? `${cleanInteger}.${fraction}` : cleanInteger;
  return negative && Number(result) !== 0 ? `-${result}` : result;
}

function isThousandsGrouped(value: string) {
  if (!value) return true;
  if (!value.includes('.')) return /^\d+$/.test(value);
  return /^\d{1,3}(\.\d{3})+$/.test(value);
}

/** Numeric value of a pt-BR decimal string, or null when invalid. */
export function parsePtBrDecimal(value: string): number | null {
  const normalized = normalizePtBrDecimal(value);
  if (normalized == null) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** API decimal ("0.2", "1500.50") -> editable pt-BR text ("0,2", "1500,50"). */
export function toPtBrDecimalInput(raw: string | number | null | undefined) {
  if (raw == null) return '';
  return String(raw).replace('.', ',');
}

/**
 * Masked BRL text ("1.234,56", produced by CurrencyInput) -> exact API
 * decimal string ("1234.56"). Null when empty.
 */
export function brlMaskToDecimalString(masked: string): string | null {
  const digits = masked.replace(/\D/g, '');
  if (!digits) return null;
  const padded = digits.padStart(3, '0');
  const integer = padded.slice(0, -2).replace(/^0+(?=\d)/, '');
  return `${integer}.${padded.slice(-2)}`;
}

/** Money string from the API -> integer cents (rounded). */
export function toCents(raw: string | number | null | undefined) {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}
