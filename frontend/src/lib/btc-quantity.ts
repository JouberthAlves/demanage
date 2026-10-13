import { normalizePtBrDecimal } from '@/lib/decimal-input';

/**
 * BTC <-> satoshi conversion done on decimal strings / BigInt only, so
 * 1.23456789 BTC is exactly 123456789 sats (floats give 123456788.99999999).
 */

export const SATS_PER_BTC = 100_000_000;
const SATS_DECIMALS = 8;

export type BtcQuantityUnit = 'BTC' | 'SATS';

/**
 * Converts a canonical decimal BTC string ("1.23456789", "-0.5") to a sats
 * integer string, rounding half away from zero at the 8th decimal.
 * Null if invalid or beyond Number.MAX_SAFE_INTEGER.
 */
export function btcToSats(btc: string): string | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(btc.trim());
  if (!match) return null;
  const negative = match[1] === '-';
  const integer = match[2] ?? '0';
  const fraction = match[3] ?? '';

  const kept = fraction.slice(0, SATS_DECIMALS).padEnd(SATS_DECIMALS, '0');
  let sats = BigInt(integer) * BigInt(SATS_PER_BTC) + BigInt(kept);
  const roundUp = Number(fraction.charAt(SATS_DECIMALS) || '0') >= 5;
  if (roundUp) sats += 1n;

  if (sats > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return `${negative && sats !== 0n ? '-' : ''}${sats.toString()}`;
}

/** Sats integer string -> trimmed BTC decimal ("100000000" -> "1"). */
export function satsToBtc(sats: string): string | null {
  const match = /^(-?)(\d+)$/.exec(sats.trim());
  if (!match) return null;
  const negative = match[1] === '-';
  const digits = (match[2] ?? '0').padStart(SATS_DECIMALS + 1, '0');
  const integer = digits.slice(0, -SATS_DECIMALS).replace(/^0+(?=\d)/, '');
  const fraction = digits.slice(-SATS_DECIMALS).replace(/0+$/, '');
  const value = fraction ? `${integer}.${fraction}` : integer;
  return negative && value !== '0' ? `-${value}` : value;
}

/**
 * Normalises what the user typed (in BTC or sats) to a canonical BTC decimal
 * string, or null when invalid / zero.
 */
export function normalizeBtcQuantity(
  raw: string,
  unit: BtcQuantityUnit,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (unit === 'BTC') {
    const normalized = normalizePtBrDecimal(trimmed);
    if (normalized == null) return null;
    const sats = btcToSats(normalized);
    // More than 8 decimals cannot be represented; zero is not a quantity.
    const decimals = normalized.split('.')[1]?.length ?? 0;
    if (decimals > SATS_DECIMALS || sats == null || sats === '0') return null;
    return normalized;
  }

  const negative = trimmed.startsWith('-');
  const digits = trimmed.replace(/^-/, '').replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const sats = digits.replace(/^0+(?=\d)/, '');
  if (sats === '0' || !Number.isSafeInteger(Number(sats))) return null;
  return satsToBtc(negative ? `-${sats}` : sats);
}

/**
 * Text for the quantity field after switching unit. Empty when the current
 * text is not a valid quantity (or does not fit the target unit).
 */
export function convertBtcInput(
  raw: string,
  from: BtcQuantityUnit,
  to: BtcQuantityUnit,
): string {
  const btc = normalizeBtcQuantity(raw, from);
  if (!btc) return '';
  if (to === 'BTC') return btc.replace('.', ',');
  return btcToSats(btc) ?? '';
}

/** Display text for a position/transaction quantity. */
export function formatAssetQuantity(asset: 'BTC' | 'USD', raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return '0';
  if (asset === 'BTC' && Math.abs(value) < 0.001) {
    const sats = btcToSats(raw);
    if (sats != null) {
      return `${Number(sats).toLocaleString('pt-BR')} sats`;
    }
  }
  return `${value.toLocaleString('pt-BR', {
    maximumFractionDigits: asset === 'BTC' ? 8 : 4,
  })} ${asset}`;
}
