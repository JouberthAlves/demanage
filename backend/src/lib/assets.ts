import { Prisma } from '@/generated/prisma/client';
import type { Asset, AssetTransaction } from '@/generated/prisma/client';

import {
  calculateAssetAccounting,
  enrichAccountingWithQuote,
  isAssetTimelineValid,
} from '@/lib/asset-accounting';
import {
  dateOnlyUtc,
  decimal,
  money,
  ZERO,
} from '@/lib/decimal';
import { todayInSaoPaulo } from '@/lib/card-billing';
import { getAssetQuote } from '@/lib/market-data';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';
import { MAX_MONEY_AMOUNT } from '@/lib/validate';

export function parseAsset(value: unknown): Asset | null {
  return value === 'BTC' || value === 'USD' ? value : null;
}

export function serializeAssetTransaction(transaction: AssetTransaction) {
  return {
    id: transaction.id,
    asset: transaction.asset,
    type: transaction.type,
    quantity: transaction.quantity.toString(),
    cashAmountBrl: transaction.cashAmountBrl.toString(),
    feeAmountBrl: transaction.feeAmountBrl.toString(),
    feePercent: transaction.feePercent?.toString() ?? null,
    costBasisKnown: transaction.costBasisKnown,
    date: transaction.date.toISOString(),
    note: transaction.note,
    expenseId: transaction.expenseId,
    entryId: transaction.entryId,
    createdAt: transaction.createdAt.toISOString(),
  };
}

export async function assetSummary(userId: string, asset: Asset) {
  const [transactions, quote] = await Promise.all([
    prisma.assetTransaction.findMany({
      where: { userId, asset },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    }),
    getAssetQuote(asset),
  ]);
  const accounting = calculateAssetAccounting(asset, transactions);
  return {
    ...enrichAccountingWithQuote(accounting, quote.value),
    quote: {
      valueBrl: quote.value,
      stale: quote.stale,
      provider: quote.provider,
      asOf: quote.asOf,
    },
  };
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

export class AssetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetValidationError';
  }
}

export function parseAssetDate(value: unknown, now = new Date()) {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) {
    throw new AssetValidationError('Data inválida');
  }
  const normalized = dateOnlyUtc(date);
  if (normalized.getTime() > dateOnlyUtc(todayInSaoPaulo(now)).getTime()) {
    throw new AssetValidationError('Data futura não é permitida');
  }
  return normalized;
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

export function parseAssetTransactionValues(
  asset: Asset,
  input: UpdateAssetTransactionInput,
) {
  const allowNegative = input.type === 'MANUAL_ADJUSTMENT';
  const quantity = parseQuantity(input.quantity, asset, allowNegative);
  const cash = parseDecimalValue(input.cashAmountBrl, 'Valor em BRL', 18, 8, false);
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
  if (input.type !== 'MANUAL_ADJUSTMENT' && money(cash).gt(MAX_MONEY_AMOUNT)) {
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

function assertTransactionTimelineValid(
  transactions: Parameters<typeof isAssetTimelineValid>[0],
) {
  if (!isAssetTimelineValid(transactions)) {
    throw new AssetValidationError(
      'A movimentação deixaria a posição negativa em uma data',
    );
  }
}

export async function createAssetTransaction(
  input: CreateAssetTransactionInput,
) {
  const parsed = parseAssetTransactionValues(input.asset, input);
  const { quantity, cash, feePercent, fee, date, costBasisKnown } = parsed;

  return withUserWriteLockTransaction(input.userId, async (tx) => {
    let expenseId: string | null = null;
    let entryId: string | null = null;

    if (input.type === 'BUY') {
      const expense = await tx.expense.create({
        data: {
          userId: input.userId,
          name: `Compra ${input.asset}`,
          amount: money(cash),
          category: 'investimento',
          frequency: 'unica',
          occurredAt: date,
          systemOrigin: 'asset',
          notes: input.note || `Transferência interna para ${input.asset}`,
        },
      });
      expenseId = expense.id;
    }

    if (input.type === 'SELL') {
      const entry = await tx.entry.create({
        data: {
          userId: input.userId,
          name: `Venda ${input.asset}`,
          amount: money(cash),
          type: 'outro',
          frequency: 'unica',
          date,
          systemOrigin: 'asset',
        },
      });
      entryId = entry.id;
    }

    const created = await tx.assetTransaction.create({
      data: {
        userId: input.userId,
        asset: input.asset,
        type: input.type,
        quantity,
        cashAmountBrl: cash,
        feeAmountBrl: fee,
        feePercent,
        costBasisKnown,
        date,
        note: input.note,
        expenseId,
        entryId,
      },
    });

    const timeline = await tx.assetTransaction.findMany({
      where: { userId: input.userId, asset: input.asset },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    assertTransactionTimelineValid(timeline);
    return created;
  });
}

export async function updateAssetTransaction(
  userId: string,
  transactionId: string,
  input: UpdateAssetTransactionInput,
) {
  return withUserWriteLockTransaction(userId, async (tx) => {
    const target = await tx.assetTransaction.findFirst({
      where: { id: transactionId, userId },
    });
    if (!target) {
      throw new AssetValidationError('Movimentação não encontrada');
    }

    const parsed = parseAssetTransactionValues(target.asset, input);
    const { quantity, cash, feePercent, fee, date, costBasisKnown } = parsed;
    const remaining = await tx.assetTransaction.findMany({
      where: { userId, asset: target.asset, id: { not: target.id } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    assertTransactionTimelineValid([
      ...remaining,
      {
        id: target.id,
        asset: target.asset,
        type: input.type,
        quantity,
        cashAmountBrl: cash,
        costBasisKnown,
        date,
        createdAt: target.createdAt,
      },
    ]);

    let expenseId = target.expenseId;
    let entryId = target.entryId;

    if (input.type === 'BUY') {
      if (entryId) {
        await tx.entry.deleteMany({ where: { id: entryId, userId } });
        entryId = null;
      }
      if (expenseId) {
        await tx.expense.update({
          where: { id: expenseId },
          data: {
            name: `Compra ${target.asset}`,
            amount: money(cash),
            category: 'investimento',
            frequency: 'unica',
            occurredAt: date,
            systemOrigin: 'asset',
            notes: input.note || `Transferência interna para ${target.asset}`,
          },
        });
      } else {
        const expense = await tx.expense.create({
          data: {
            userId,
            name: `Compra ${target.asset}`,
            amount: money(cash),
            category: 'investimento',
            frequency: 'unica',
            occurredAt: date,
            systemOrigin: 'asset',
            notes: input.note || `Transferência interna para ${target.asset}`,
          },
        });
        expenseId = expense.id;
      }
    } else if (input.type === 'SELL') {
      if (expenseId) {
        await tx.expense.deleteMany({ where: { id: expenseId, userId } });
        expenseId = null;
      }
      if (entryId) {
        await tx.entry.update({
          where: { id: entryId },
          data: {
            name: `Venda ${target.asset}`,
            amount: money(cash),
            type: 'outro',
            frequency: 'unica',
            date,
            systemOrigin: 'asset',
          },
        });
      } else {
        const entry = await tx.entry.create({
          data: {
            userId,
            name: `Venda ${target.asset}`,
            amount: money(cash),
            type: 'outro',
            frequency: 'unica',
            date,
            systemOrigin: 'asset',
          },
        });
        entryId = entry.id;
      }
    } else {
      if (expenseId) {
        await tx.expense.deleteMany({ where: { id: expenseId, userId } });
        expenseId = null;
      }
      if (entryId) {
        await tx.entry.deleteMany({ where: { id: entryId, userId } });
        entryId = null;
      }
    }

    return tx.assetTransaction.update({
      where: { id: target.id },
      data: {
        type: input.type,
        quantity,
        cashAmountBrl: cash,
        feeAmountBrl: fee,
        feePercent,
        costBasisKnown,
        date,
        note: input.note,
        expenseId,
        entryId,
      },
    });
  });
}

export async function deleteAssetTransaction(
  userId: string,
  transactionId: string,
) {
  await withUserWriteLockTransaction(userId, async (tx) => {
    const target = await tx.assetTransaction.findFirst({
      where: { id: transactionId, userId },
    });
    if (!target) {
      throw new AssetValidationError('Movimentação não encontrada');
    }

    const remaining = await tx.assetTransaction.findMany({
      where: { userId, asset: target.asset, id: { not: target.id } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    assertTransactionTimelineValid(remaining);

    await tx.assetTransaction.delete({ where: { id: target.id } });
    if (target.expenseId) {
      await tx.expense.deleteMany({
        where: { id: target.expenseId, userId },
      });
    }
    if (target.entryId) {
      await tx.entry.deleteMany({ where: { id: target.entryId, userId } });
    }
  });
}
