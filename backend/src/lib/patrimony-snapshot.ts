import type { PrismaClient } from '@/generated/prisma/client';
import { PatrimonyError } from '@/lib/patrimony-calc';

/** Keep the short database read bounded; market/network requests run afterwards. */
const READ_TX_OPTIONS = {
  isolationLevel: 'RepeatableRead',
  maxWait: 5_000,
  timeout: 15_000,
} as const;

export async function readPatrimonySnapshot(
  client: Pick<PrismaClient, '$transaction'>,
  userId: string,
) {
  return client.$transaction(async (tx) => {
    const settings = await tx.patrimonySettings.findUnique({
      where: { userId },
    });
    if (!settings) {
      throw new PatrimonyError('Patrimônio ainda não configurado');
    }

    // An atomic asset/piggy transfer writes both a financial row and its
    // internal transaction. Every read (including settings) must use the
    // same MVCC snapshot, including relations loaded through `include`.
    const [expenses, entries, assetTransactions, piggyTransactions] =
      await Promise.all([
        tx.expense.findMany({
          where: { userId },
          include: { splits: true, payments: true },
        }),
        tx.entry.findMany({ where: { userId }, include: { receipts: true } }),
        tx.assetTransaction.findMany({
          where: { userId },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        }),
        tx.piggyTransaction.findMany({
          where: { userId },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        }),
      ]);

    return {
      settings,
      expenses,
      entries,
      assetTransactions,
      piggyTransactions,
    };
  }, READ_TX_OPTIONS);
}
