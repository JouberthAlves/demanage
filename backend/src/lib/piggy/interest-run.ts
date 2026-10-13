import type { Prisma } from '@/generated/prisma/client';
import {
  addDaysToKey,
  dayKeyInSaoPaulo,
  dayKeyOfDate,
  dayKeyToDate,
} from '@/lib/civil-date';
import { getCdiHistory } from '@/lib/market';
import type { MarketPoint, MarketSeries } from '@/lib/market/types';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

import { runPiggyAutoDebits } from './auto-debit-run';
import {
  accrueCdiInterest,
  lastCompletedWeekday,
  splitCdiHistoryRange,
} from './interest';

type FetchHistory = typeof getCdiHistory;

async function getCdiHistoryInChunks(
  from: Date,
  to: Date,
  fetchHistory: FetchHistory,
): Promise<MarketSeries> {
  const points = new Map<string, MarketPoint>();
  let provider = 'bcb_sgs_12';
  let stale = false;

  for (const range of splitCdiHistoryRange(from, to)) {
    const series = await fetchHistory(range.from, range.to);
    provider = series.provider;
    stale ||= series.stale;
    for (const point of series.points) points.set(point.date, point);
  }

  return {
    provider,
    stale,
    points: [...points.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function startKeyFor(bank: {
  createdAt: Date;
  interestAccruedThrough: Date | null;
}) {
  return bank.interestAccruedThrough
    ? addDaysToKey(dayKeyOfDate(bank.interestAccruedThrough), 1)
    : dayKeyInSaoPaulo(bank.createdAt);
}

/**
 * Auto-debits first (so deposits count for the days they are dated), then CDI
 * interest. A bank whose auto-debit failed is skipped for interest this round;
 * every other bank is processed normally.
 */
export async function catchUpPiggyInterest(
  userId: string,
  options: { now?: Date; fetchHistory?: FetchHistory } = {},
) {
  let autoDebitCreatedCount = 0;
  let autoDebitFailedCount = 0;
  try {
    const autoDebit = await runPiggyAutoDebits(userId, options.now);
    autoDebitCreatedCount = autoDebit.createdCount;
    autoDebitFailedCount = autoDebit.failedBankIds.length;

    const interest = await accruePiggyInterest(userId, {
      ...options,
      skipBankIds: new Set(autoDebit.failedBankIds),
    });
    return {
      createdCount: interest.createdCount,
      stale: interest.stale || autoDebitFailedCount > 0,
      autoDebitCreatedCount,
      autoDebitFailedCount,
    };
  } catch (error) {
    console.error(error);
    return {
      createdCount: 0,
      stale: true,
      autoDebitCreatedCount,
      autoDebitFailedCount,
    };
  }
}

async function accruePiggyInterest(
  userId: string,
  {
    now = new Date(),
    fetchHistory = getCdiHistory,
    skipBankIds = new Set<string>(),
  }: { now?: Date; fetchHistory?: FetchHistory; skipBankIds?: Set<string> },
) {
  const banks = (
    await prisma.piggyBank.findMany({
      where: {
        userId,
        yieldEnabled: true,
        archivedAt: null,
        cdiPercent: { gt: 0 },
      },
      select: { id: true, createdAt: true, interestAccruedThrough: true },
    })
  ).filter((bank) => !skipBankIds.has(bank.id));

  const target = lastCompletedWeekday(now);
  const targetKey = dayKeyOfDate(target);
  const seriesByBank = new Map<string, MarketSeries>();
  let stale = false;

  for (const bank of banks) {
    const startKey = startKeyFor(bank);
    if (startKey > targetKey) continue;
    try {
      const series = await getCdiHistoryInChunks(
        dayKeyToDate(startKey),
        target,
        fetchHistory,
      );
      seriesByBank.set(bank.id, series);
      stale ||= series.stale;
    } catch {
      stale = true;
    }
  }

  const createdCount = await withUserWriteLockTransaction(
    userId,
    async (tx) => {
      const currentBanks = await tx.piggyBank.findMany({
        where: {
          id: { in: [...seriesByBank.keys()] },
          userId,
          yieldEnabled: true,
          archivedAt: null,
          cdiPercent: { gt: 0 },
        },
        include: {
          transactions: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
        },
      });

      const rows: Prisma.PiggyTransactionCreateManyInput[] = [];
      for (const bank of currentBanks) {
        const series = seriesByBank.get(bank.id);
        if (!series) continue;
        const startKey = startKeyFor(bank);
        if (startKey > targetKey) continue;

        const result = accrueCdiInterest({
          bankId: bank.id,
          transactions: bank.transactions,
          accruedThrough: bank.interestAccruedThrough
            ? dayKeyOfDate(bank.interestAccruedThrough)
            : null,
          points: series.points,
          cdiPercent: bank.cdiPercent,
          startKey,
          targetKey,
        });

        for (const posting of result.postings) {
          rows.push({
            piggyBankId: bank.id,
            userId,
            type: 'interest',
            source: 'yield',
            amount: posting.amount,
            date: dayKeyToDate(posting.day),
            note: `Rendimento diário · ${bank.cdiPercent.toString()}% do CDI`,
            cdiRate: posting.rate,
            cdiPercent: bank.cdiPercent,
            baseBalance: posting.baseBalance,
            resultingBalance: posting.resultingBalance,
            interestKey: posting.interestKey,
          });
        }

        const nextThrough = result.accruedThrough
          ? dayKeyToDate(result.accruedThrough)
          : null;
        if (
          nextThrough &&
          nextThrough.getTime() !== bank.interestAccruedThrough?.getTime()
        ) {
          await tx.piggyBank.update({
            where: { id: bank.id },
            data: { interestAccruedThrough: nextThrough },
          });
        }
      }

      if (rows.length > 0) {
        await tx.piggyTransaction.createMany({
          data: rows,
        });
      }
      return rows.length;
    },
  );

  return { createdCount, stale };
}
