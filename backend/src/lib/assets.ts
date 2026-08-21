import type {
  Asset,
  AssetTransaction,
  AssetTransactionType,
} from '@prisma/client';

import {
  calculateAssetAccounting,
  countDecimalPlaces,
  enrichAccountingWithQuote,
} from '@/lib/asset-accounting';
import { dateOnlyUtc, decimal, money, ZERO } from '@/lib/decimal';
import { getAssetQuote } from '@/lib/market-data';
import { prisma } from '@/lib/prisma';

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

function parseDate(value: unknown) {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) {
    throw new AssetValidationError('Data inválida');
  }
  const normalized = dateOnlyUtc(date);
  if (normalized.getTime() > dateOnlyUtc(new Date()).getTime()) {
    throw new AssetValidationError('Data futura não é permitida');
  }
  return normalized;
}

function parseNonNegative(value: unknown, field: string) {
  try {
    const parsed = decimal(String(value ?? '0'));
    if (!parsed.isFinite() || parsed.lt(0)) throw new Error();
    return parsed;
  } catch {
    throw new AssetValidationError(`${field} inválido`);
  }
}

function parseQuantity(value: unknown, asset: Asset, allowNegative: boolean) {
  try {
    const raw = String(value ?? '').trim();
    const parsed = decimal(raw);
    if (
      !parsed.isFinite() ||
      parsed.eq(0) ||
      (!allowNegative && parsed.lt(0))
    ) {
      throw new Error();
    }
    if (asset === 'BTC' && countDecimalPlaces(raw) > 8) {
      throw new AssetValidationError(
        'BTC aceita no máximo 8 casas decimais',
      );
    }
    return parsed;
  } catch (error) {
    if (error instanceof AssetValidationError) throw error;
    throw new AssetValidationError('Quantidade inválida');
  }
}

function parseTransactionValues(
  asset: Asset,
  input: UpdateAssetTransactionInput,
) {
  const allowNegative = input.type === 'MANUAL_ADJUSTMENT';
  const quantity = parseQuantity(input.quantity, asset, allowNegative);
  const cash = parseNonNegative(input.cashAmountBrl, 'Valor em BRL');
  const feePercent =
    input.feePercent == null || input.feePercent === ''
      ? null
      : parseNonNegative(input.feePercent, 'Percentual de taxa');
  let fee =
    input.feeAmountBrl == null || input.feeAmountBrl === ''
      ? ZERO
      : parseNonNegative(input.feeAmountBrl, 'Taxa');
  if (fee.eq(0) && feePercent != null && cash.gt(0)) {
    fee = cash.mul(feePercent).div(100);
  }
  if (input.type !== 'MANUAL_ADJUSTMENT' && cash.lte(0)) {
    throw new AssetValidationError(
      'Compra/venda exige valor efetivo em BRL maior que zero',
    );
  }
  const date = parseDate(input.date);
  const costBasisKnown =
    input.type === 'MANUAL_ADJUSTMENT'
      ? Boolean(input.costBasisKnown && cash.gt(0))
      : true;

  return { quantity, cash, feePercent, fee, date, costBasisKnown };
}

function assertTransactionTimelineValid(
  transactions: Array<{
    id: string;
    type: AssetTransactionType;
    quantity: unknown;
    date: Date;
  }>,
) {
  const ordered = [...transactions].sort((left, right) => {
    const dateDiff = left.date.getTime() - right.date.getTime();
    return dateDiff !== 0 ? dateDiff : left.id.localeCompare(right.id);
  });
  let balance = ZERO;

  for (const transaction of ordered) {
    const quantity = decimal(transaction.quantity);
    if (transaction.type === 'BUY') {
      balance = balance.plus(quantity);
      continue;
    }
    if (transaction.type === 'SELL') {
      if (quantity.gt(balance)) {
        throw new AssetValidationError(
          'A edição deixaria uma venda sem saldo disponível nessa data',
        );
      }
      balance = balance.minus(quantity);
      continue;
    }
    balance = balance.plus(quantity);
    if (balance.lt(0)) {
      throw new AssetValidationError(
        'A edição deixaria a posição negativa nessa data',
      );
    }
  }
}

export async function createAssetTransaction(
  input: CreateAssetTransactionInput,
) {
  const parsed = parseTransactionValues(input.asset, input);
  const { quantity, cash, feePercent, fee, date, costBasisKnown } = parsed;

  const existing = await prisma.assetTransaction.findMany({
    where: { userId: input.userId, asset: input.asset },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  const current = calculateAssetAccounting(input.asset, existing);
  if (input.type === 'SELL' && quantity.gt(decimal(current.quantity))) {
    throw new AssetValidationError('Venda maior que a posição disponível');
  }
  if (
    input.type === 'MANUAL_ADJUSTMENT' &&
    quantity.lt(0) &&
    quantity.abs().gt(decimal(current.quantity))
  ) {
    throw new AssetValidationError(
      'Ajuste removeria mais unidades do que a posição atual',
    );
  }

  return prisma.$transaction(async (tx) => {
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
        },
      });
      entryId = entry.id;
    }

    return tx.assetTransaction.create({
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
  });
}

export async function updateAssetTransaction(
  userId: string,
  transactionId: string,
  input: UpdateAssetTransactionInput,
) {
  const target = await prisma.assetTransaction.findFirst({
    where: { id: transactionId, userId },
  });
  if (!target) {
    throw new AssetValidationError('Movimentação não encontrada');
  }

  const parsed = parseTransactionValues(target.asset, input);
  const { quantity, cash, feePercent, fee, date, costBasisKnown } = parsed;
  const remaining = await prisma.assetTransaction.findMany({
    where: { userId, asset: target.asset, id: { not: target.id } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });

  assertTransactionTimelineValid([
    ...remaining,
    {
      id: target.id,
      type: input.type,
      quantity,
      date,
    },
  ]);

  return prisma.$transaction(async (tx) => {
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
  const target = await prisma.assetTransaction.findFirst({
    where: { id: transactionId, userId },
  });
  if (!target) {
    throw new AssetValidationError('Movimentação não encontrada');
  }

  const remaining = await prisma.assetTransaction.findMany({
    where: { userId, asset: target.asset, id: { not: target.id } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  let balance = ZERO;
  for (const transaction of remaining) {
    if (transaction.type === 'BUY') balance = balance.plus(transaction.quantity);
    else if (transaction.type === 'SELL') {
      balance = balance.minus(transaction.quantity);
    } else {
      balance = balance.plus(transaction.quantity);
    }
    if (balance.lt(0)) {
      throw new AssetValidationError(
        'Não é possível excluir: uma venda posterior ficaria sem saldo',
      );
    }
  }

  await prisma.$transaction(async (tx) => {
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
