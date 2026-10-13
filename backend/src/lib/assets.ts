import type { Asset } from '@/generated/prisma/client';
import {
  calculateAssetAccounting,
  enrichAccountingWithQuote,
  isAssetTimelineValid,
} from '@/lib/asset-accounting';
import {
  AssetValidationError,
  type CreateAssetTransactionInput,
  parseAssetTransactionValues,
  type UpdateAssetTransactionInput,
} from '@/lib/asset-values';
import { money } from '@/lib/decimal';
import { getAssetQuote } from '@/lib/market';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

// Pure parsing/serialization lives in lib/asset-values.ts; re-exported here.
export {
  AssetValidationError,
  type CreateAssetTransactionInput,
  parseAsset,
  parseAssetDate,
  parseAssetTransactionValues,
  serializeAssetTransaction,
  type UpdateAssetTransactionInput,
} from '@/lib/asset-values';

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
