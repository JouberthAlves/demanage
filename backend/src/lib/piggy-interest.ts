import { Prisma } from '@/generated/prisma/client';

import { todayInSaoPaulo } from '@/lib/card-billing';
import { dateKey, dateOnlyUtc, decimal, money, ZERO } from '@/lib/decimal';
import {
  getCdiHistory,
  MAX_HISTORY_RANGE_DAYS,
  type MarketPoint,
  type MarketSeries,
} from '@/lib/market-data';
import { prisma } from '@/lib/prisma';
import { processPiggyAutoDebits } from '@/lib/piggy';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

function signedAmount(
  type: 'deposit' | 'withdraw' | 'interest',
  amount: Prisma.Decimal,
) {
  return type === 'withdraw' ? amount.negated() : amount;
}

export function calculateCdiInterest(
  balance: Prisma.Decimal,
  dailyRatePercent: Prisma.Decimal,
  cdiPercent: Prisma.Decimal,
) {
  if (balance.lte(0) || dailyRatePercent.lte(0) || cdiPercent.lte(0)) {
    return ZERO;
  }
  return money(balance.mul(dailyRatePercent).div(100).mul(cdiPercent).div(100));
}

export function lastCompletedWeekday(now = new Date()) {
  const target = dateOnlyUtc(todayInSaoPaulo(now));
  target.setUTCDate(target.getUTCDate() - 1);

  while (target.getUTCDay() === 0 || target.getUTCDay() === 6) {
    target.setUTCDate(target.getUTCDate() - 1);
  }

  return target;
}

export function splitCdiHistoryRange(from: Date, to: Date) {
  const ranges: Array<{ from: string; to: string }> = [];
  let cursor = dateOnlyUtc(from);
  const lastDate = dateOnlyUtc(to);
  while (cursor <= lastDate) {
    const maxEnd = new Date(cursor);
    maxEnd.setUTCDate(maxEnd.getUTCDate() + MAX_HISTORY_RANGE_DAYS - 1);
    const end = maxEnd < lastDate ? maxEnd : lastDate;
    ranges.push({ from: dateKey(cursor), to: dateKey(end) });
    cursor = new Date(end);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return ranges;
}

async function getCdiHistoryInChunks(
  from: Date,
  to: Date,
  fetchHistory: typeof getCdiHistory = getCdiHistory,
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

export async function catchUpPiggyInterest(
  userId: string,
  options: { now?: Date; fetchHistory?: typeof getCdiHistory } = {},
) {
  let autoDebitCreatedCount = 0;
  let autoDebitFailedCount = 0;
  try {
    const autoDebit = await processPiggyAutoDebits(userId, options.now);
    autoDebitCreatedCount = autoDebit.createdCount;
    autoDebitFailedCount = autoDebit.failedCount;
    if (autoDebitFailedCount > 0) {
      return {
        createdCount: 0,
        stale: true,
        autoDebitCreatedCount,
        autoDebitFailedCount,
      };
    }

    return {
      ...(await accruePiggyInterest(userId, options)),
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
  }: { now?: Date; fetchHistory?: typeof getCdiHistory },
) {
  const banks = await prisma.piggyBank.findMany({
    where: {
      userId,
      yieldEnabled: true,
      archivedAt: null,
      cdiPercent: { gt: 0 },
    },
    select: {
      id: true,
      createdAt: true,
      interestAccruedThrough: true,
    },
  });

  const target = lastCompletedWeekday(now);
  const seriesByBank = new Map<string, MarketSeries>();
  let stale = false;

  for (const bank of banks) {
    const start = bank.interestAccruedThrough
      ? new Date(bank.interestAccruedThrough.getTime() + 86_400_000)
      : dateOnlyUtc(todayInSaoPaulo(bank.createdAt));
    if (start > target) continue;

    let series: MarketSeries;
    try {
      series = await getCdiHistoryInChunks(start, target, fetchHistory);
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
          userId,
          yieldEnabled: true,
          archivedAt: null,
          cdiPercent: { gt: 0 },
        },
        include: {
          transactions: { orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] },
        },
      });

      let insertedCount = 0;
      for (const bank of currentBanks) {
        const series = seriesByBank.get(bank.id);
        if (!series) continue;

        const start = bank.interestAccruedThrough
          ? new Date(bank.interestAccruedThrough.getTime() + 86_400_000)
          : dateOnlyUtc(todayInSaoPaulo(bank.createdAt));
        if (start > target) continue;

        const transactions = [...bank.transactions];
        let lastProcessed = bank.interestAccruedThrough;

        for (const point of series.points) {
          const day = dateOnlyUtc(point.date);
          if (day < start || day > target) continue;
          const interestKey = `${bank.id}:${point.date}`;
          if (transactions.some((tx) => tx.interestKey === interestKey)) {
            lastProcessed = day;
            continue;
          }

          let balance = ZERO;
          for (const transaction of transactions) {
            if (dateOnlyUtc(todayInSaoPaulo(transaction.date)) > day) continue;
            balance = balance.plus(
              signedAmount(transaction.type, decimal(transaction.amount)),
            );
          }

          const rate = decimal(point.value);
          const interest = calculateCdiInterest(
            balance,
            rate,
            decimal(bank.cdiPercent),
          );
          if (interest.gt(0)) {
            const created = {
              piggyBankId: bank.id,
              userId,
              type: 'interest' as const,
              source: 'yield' as const,
              amount: interest,
              date: day,
              note: `Rendimento diário · ${bank.cdiPercent.toString()}% do CDI`,
              cdiRate: rate,
              cdiPercent: bank.cdiPercent,
              baseBalance: balance,
              resultingBalance: balance.plus(interest),
              interestKey,
            };
            await tx.piggyTransaction.create({ data: created });
            transactions.push({
              ...created,
              id: interestKey,
              expenseId: null,
              entryId: null,
              createdAt: day,
            });
            insertedCount += 1;
          }
          lastProcessed = day;
        }

        if (lastProcessed) {
          await tx.piggyBank.update({
            where: { id: bank.id },
            data: { interestAccruedThrough: lastProcessed },
          });
        }
      }
      return insertedCount;
    },
  );

  return { createdCount, stale };
}
