import { Prisma } from '@prisma/client';

import { dateKey, dateOnlyUtc, decimal, money, ZERO } from '@/lib/decimal';
import { getCdiHistory } from '@/lib/market-data';
import { prisma } from '@/lib/prisma';

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
  if (
    balance.lte(0) ||
    dailyRatePercent.lte(0) ||
    cdiPercent.lte(0)
  ) {
    return ZERO;
  }
  return money(
    balance.mul(dailyRatePercent).div(100).mul(cdiPercent).div(100),
  );
}

function isPrismaUniqueConflict(error: unknown) {
  return (
    typeof error === 'object' &&
    error != null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

export async function catchUpPiggyInterest(userId: string) {
  try {
    return await accruePiggyInterest(userId);
  } catch (error) {
    console.error(error);
    return { createdCount: 0, stale: true };
  }
}

async function accruePiggyInterest(userId: string) {
  const banks = await prisma.piggyBank.findMany({
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

  let createdCount = 0;
  let stale = false;
  const today = dateOnlyUtc(new Date());

  for (const bank of banks) {
    const start = bank.interestAccruedThrough
      ? new Date(bank.interestAccruedThrough.getTime() + 86_400_000)
      : dateOnlyUtc(bank.createdAt);
    if (start > today) continue;

    let series: Awaited<ReturnType<typeof getCdiHistory>>;
    try {
      series = await getCdiHistory(dateKey(start), dateKey(today));
      stale ||= series.stale;
    } catch {
      stale = true;
      continue;
    }

    const transactions = [...bank.transactions];
    let lastProcessed = bank.interestAccruedThrough;

    for (const point of series.points) {
      const day = dateOnlyUtc(point.date);
      if (day < start || day > today) continue;
      const interestKey = `${bank.id}:${point.date}`;
      if (transactions.some((tx) => tx.interestKey === interestKey)) {
        lastProcessed = day;
        continue;
      }

      let balance = ZERO;
      for (const transaction of transactions) {
        if (dateOnlyUtc(transaction.date) > day) continue;
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
        try {
          const created = await prisma.piggyTransaction.create({
            data: {
              piggyBankId: bank.id,
              userId,
              type: 'interest',
              source: 'yield',
              amount: interest,
              date: day,
              note: `Rendimento diário · ${bank.cdiPercent.toString()}% do CDI`,
              cdiRate: rate,
              cdiPercent: bank.cdiPercent,
              baseBalance: balance,
              resultingBalance: balance.plus(interest),
              interestKey,
            },
          });
          transactions.push(created);
          createdCount += 1;
        } catch (error) {
          if (!isPrismaUniqueConflict(error)) throw error;
        }
      }
      lastProcessed = day;
    }

    if (lastProcessed) {
      await prisma.piggyBank.update({
        where: { id: bank.id },
        data: { interestAccruedThrough: lastProcessed },
      });
    }
  }

  return { createdCount, stale };
}
