import type { Asset, AssetTransaction } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import {
  dayKeyToDate,
  isValidDayKey,
  todayKeyInSaoPaulo,
} from '@/lib/civil-date';
import { decimal, ZERO } from '@/lib/decimal';
import { DomainError } from '@/lib/errors';
import { plainDecimal, toMoney } from '@/lib/money';
import { MAX_MONEY_AMOUNT } from '@/lib/validate';

/** Pure asset input parsing / serialization (no database import). */

export function parseAsset(value: unknown): Asset | null {
  return value === 'BTC' || value === 'USD' ? value : null;
}

export class AssetValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'ASSET_VALIDATION');
  }
}

export type CreateAssetTransactionInput = {
  userId: string;
  asset: Asset;
  type: 'BUY' | 'SELL' | 'MANUAL_ADJUSTMENT';
  quantity: unknown;
  cashAmountBrl: unknown;
  feeAmountBrl?: unknown;
  feePercent?: unknown;
  costBasisKnown?: boolean;
  date: unknown;
  note?: string | null;
};

export type UpdateAssetTransactionInput = Omit<
  CreateAssetTransactionInput,
  'userId' | 'asset'
>;

/** Plain decimal strings only: Decimal#toString() would emit "1e-12". */
export function serializeAssetTransaction(transaction: AssetTransaction) {
  return {
    id: transaction.id,
    asset: transaction.asset,
    type: transaction.type,
    quantity: plainDecimal(transaction.quantity),
    cashAmountBrl: plainDecimal(transaction.cashAmountBrl),
    feeAmountBrl: plainDecimal(transaction.feeAmountBrl),
    feePercent:
      transaction.feePercent == null
        ? null
        : plainDecimal(transaction.feePercent),
    costBasisKnown: transaction.costBasisKnown,
    date: transaction.date.toISOString(),
    note: transaction.note,
    expenseId: transaction.expenseId,
    entryId: transaction.entryId,
    createdAt: transaction.createdAt.toISOString(),
  };
}

/**
 * Asset dates are ledger dates (NOON UTC). Accepts a strict YYYY-MM-DD or an
 * ISO timestamp (as returned by serializeAssetTransaction); impossible dates
 * such as 2026-02-30 are rejected in both forms.
 */
export function parseAssetDate(value: unknown, now = new Date()) {
  const raw = String(value ?? '').trim();
  let dayKey: string;
  if (isValidDayKey(raw)) {
    dayKey = raw;
  } else if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const instant = new Date(raw);
    if (!isValidDayKey(raw.slice(0, 10)) || Number.isNaN(instant.getTime())) {
      throw new AssetValidationError('Data inválida');
    }
    dayKey = instant.toISOString().slice(0, 10);
  } else {
    throw new AssetValidationError('Data inválida');
  }
  if (dayKey > todayKeyInSaoPaulo(now)) {
    throw new AssetValidationError('Data futura não é permitida');
  }
  return dayKeyToDate(dayKey, 'noon');
}

function parseDecimalValue(
  value: unknown,
  field: string,
  precision: number,
  scale: number,
  allowNegative: boolean,
) {
  const raw = String(value ?? '').trim();
  const pattern = allowNegative ? /^-?\d+(?:\.\d+)?$/ : /^\d+(?:\.\d+)?$/;
  const unsigned = raw.startsWith('-') ? raw.slice(1) : raw;
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  const integerDigits = integerPart?.replace(/^0+/, '').length ?? 0;
  if (!pattern.test(raw)) {
    throw new AssetValidationError(`${field} inválido`);
  }
  if (integerDigits > precision - scale || fractionPart.length > scale) {
    throw new AssetValidationError(`${field} excede a precisão permitida`);
  }

  try {
    const parsed = decimal(raw);
    if (!parsed.isFinite() || (!allowNegative && parsed.lt(0))) throw new Error();
    return parsed;
  } catch {
    throw new AssetValidationError(`${field} inválido`);
  }
}

function parseQuantity(value: unknown, asset: Asset, allowNegative: boolean) {
  const scale = asset === 'BTC' ? 8 : 12;
  const parsed = parseDecimalValue(value, 'Quantidade', 30, scale, allowNegative);
  if (parsed.eq(0)) throw new AssetValidationError('Quantidade inválida');
  return parsed;
}

/**
 * `cash` (the BRL cost basis / proceeds) is rounded ONCE to cents here, so the
 * AssetTransaction (Decimal 18,8) and the ledger Expense/Entry (Decimal 12,2)
 * always carry the same amount.
 */
export function parseAssetTransactionValues(
  asset: Asset,
  input: UpdateAssetTransactionInput,
) {
  const allowNegative = input.type === 'MANUAL_ADJUSTMENT';
  const quantity = parseQuantity(input.quantity, asset, allowNegative);
  parseDecimalValue(input.cashAmountBrl, 'Valor em BRL', 18, 8, false);
  const cash = toMoney(String(input.cashAmountBrl).trim());
  const feePercent =
    input.feePercent == null || input.feePercent === ''
      ? null
      : parseDecimalValue(
          input.feePercent,
          'Percentual de taxa',
          12,
          8,
          false,
        );
  let fee =
    input.feeAmountBrl == null || input.feeAmountBrl === ''
      ? ZERO
      : parseDecimalValue(input.feeAmountBrl, 'Taxa', 18, 8, false);
  if (fee.eq(0) && feePercent != null && cash.gt(0)) {
    fee = parseDecimalValue(
      cash
        .mul(feePercent)
        .div(100)
        .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP)
        .toFixed(8),
      'Taxa',
      18,
      8,
      false,
    );
  }
  if (input.type !== 'MANUAL_ADJUSTMENT' && cash.lte(0)) {
    throw new AssetValidationError(
      'Compra/venda exige valor efetivo em BRL maior que zero',
    );
  }
  if (input.type !== 'MANUAL_ADJUSTMENT' && cash.gt(MAX_MONEY_AMOUNT)) {
    throw new AssetValidationError(
      'Valor em BRL excede o limite das movimentações financeiras',
    );
  }
  const date = parseAssetDate(input.date);
  const costBasisKnown =
    input.type === 'MANUAL_ADJUSTMENT'
      ? Boolean(input.costBasisKnown && cash.gt(0))
      : true;

  return { quantity, cash, feePercent, fee, date, costBasisKnown };
}
