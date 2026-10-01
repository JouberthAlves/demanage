import type {
  PiggyBank,
  PiggyTransaction,
  Prisma,
} from '@/generated/prisma/client';

import { todayInSaoPaulo } from '@/lib/card-billing';
import { dateOnlyUtc, decimal, money, ZERO } from '@/lib/decimal';
import { parseDateOnly } from '@/lib/entry-schedule';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

export function monthsUntilTarget(from: Date, targetDate: Date) {
  const fromYear = from.getUTCFullYear();
  const fromMonth = from.getUTCMonth();
  const toYear = targetDate.getUTCFullYear();
  const toMonth = targetDate.getUTCMonth();
  const months = (toYear - fromYear) * 12 + (toMonth - fromMonth);
  return Math.max(1, months);
}

export function piggyGoalAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

export function computeMonthlyGoal(
  goalAmount: number | null,
  targetDate: Date | null,
  from = new Date(),
) {
  if (!goalAmount || goalAmount <= 0 || !targetDate) return 0;
  const today = todayInSaoPaulo(from);
  const months = monthsUntilTarget(
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1, 12)),
    targetDate,
  );
  return Math.round((goalAmount / months) * 100) / 100;
}

export function balanceDecimalFromTransactions(
  transactions: Pick<PiggyTransaction, 'type' | 'amount'>[],
) {
  return transactions.reduce((sum, transaction) => {
    const amount = decimal(transaction.amount);
    return transaction.type === 'withdraw'
      ? sum.minus(amount)
      : sum.plus(amount);
  }, ZERO);
}

export function balanceFromTransactions(
  transactions: Pick<PiggyTransaction, 'type' | 'amount'>[],
) {
  return Number(balanceDecimalFromTransactions(transactions));
}

export function serializePiggyBank(
  bank: PiggyBank & { transactions?: PiggyTransaction[] },
) {
  const transactions = bank.transactions ?? [];
  const balance = balanceFromTransactions(transactions);
  const goalAmount = piggyGoalAmount(bank.goalAmount);
  const monthlyGoal = Number(bank.monthlyGoal);
  const hasGoal = goalAmount != null;

  return {
    id: bank.id,
    name: bank.name,
    goalAmount,
    targetDate: bank.targetDate
      ? bank.targetDate.toISOString().slice(0, 10)
      : null,
    monthlyGoal,
    autoDebit: bank.autoDebit,
    autoDebitDay: bank.autoDebitDay,
    isEmergency: bank.isEmergency,
    yieldEnabled: Boolean(bank.yieldEnabled),
    cdiPercent: Number.isFinite(Number(bank.cdiPercent))
      ? Number(bank.cdiPercent)
      : 0,
    interestAccruedThrough:
      bank.interestAccruedThrough?.toISOString().slice(0, 10) ?? null,
    archivedAt: bank.archivedAt?.toISOString() ?? null,
    completedAt: bank.completedAt?.toISOString() ?? null,
    balance,
    progress: hasGoal ? Math.min(balance / goalAmount, 1) : 0,
    remaining: hasGoal ? Math.max(goalAmount - balance, 0) : 0,
    createdAt: bank.createdAt.toISOString(),
    updatedAt: bank.updatedAt.toISOString(),
  };
}

export function serializePiggyTransaction(transaction: PiggyTransaction) {
  return {
    id: transaction.id,
    piggyBankId: transaction.piggyBankId,
    type: transaction.type,
    source: transaction.source,
    amount: Number(transaction.amount),
    date: transaction.date.toISOString().slice(0, 10),
    expenseId: transaction.expenseId,
    entryId: transaction.entryId,
    note: transaction.note,
    cdiRate: transaction.cdiRate == null ? null : Number(transaction.cdiRate),
    cdiPercent:
      transaction.cdiPercent == null ? null : Number(transaction.cdiPercent),
    baseBalance:
      transaction.baseBalance == null ? null : Number(transaction.baseBalance),
    resultingBalance:
      transaction.resultingBalance == null
        ? null
        : Number(transaction.resultingBalance),
    createdAt: transaction.createdAt.toISOString(),
  };
}

export function parseTargetDate(value: unknown) {
  const date = parseDateOnly(value, 'INVALID_TARGET_DATE');
  if (!date) throw new Error('INVALID_TARGET_DATE');
  const normalized = dateOnlyUtc(date);
  if (normalized < todayInSaoPaulo()) throw new Error('PAST_TARGET_DATE');
  return normalized;
}

export function parseOptionalTargetDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  return parseTargetDate(value);
}

type DepositParams = {
  userId: string;
  piggyBankId: string;
  amount: number;
  source?: 'manual' | 'auto_debit';
  note?: string | null;
  date?: Date;
};

async function depositToPiggyBankInTransaction(
  tx: Prisma.TransactionClient,
  {
    userId,
    piggyBankId,
    amount,
    source = 'manual',
    note = null,
    date = new Date(),
  }: DepositParams,
) {
  const requested = money(amount);
  const day = todayInSaoPaulo(date);

  const bank = await tx.piggyBank.findFirst({
    where: { id: piggyBankId, userId },
    include: { transactions: true },
  });
  if (!bank) throw new Error('NOT_FOUND');
  if (bank.archivedAt) throw new Error('ARCHIVED');

  if (source === 'auto_debit') {
    const monthStart = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1, 12),
    );
    const nextMonthStart = new Date(
      Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 1, 12),
    );
    const existingAutoDebit = await tx.piggyTransaction.findFirst({
      where: {
        piggyBankId: bank.id,
        userId,
        source: 'auto_debit',
        type: 'deposit',
        date: { gte: monthStart, lt: nextMonthStart },
      },
    });
    if (existingAutoDebit) {
      return {
        bank,
        transaction: existingAutoDebit,
        completed: false,
        depositAmount: 0,
        alreadyProcessed: true,
      };
    }
  }

  const currentBalance = balanceDecimalFromTransactions(bank.transactions);
  const goalAmount = bank.goalAmount == null ? null : decimal(bank.goalAmount);
  const remaining =
    goalAmount == null ? null : goalAmount.minus(currentBalance);
  if (remaining != null && remaining.lte(0)) {
    throw new Error('ALREADY_COMPLETE');
  }
  const depositAmount =
    remaining == null || requested.lte(remaining) ? requested : remaining;

  const expense = await tx.expense.create({
    data: {
      userId,
      name: `Cofrinho · ${bank.name}`,
      amount: depositAmount,
      category: 'cofrinho',
      frequency: 'unica',
      occurredAt: day,
      systemOrigin: 'piggy',
      notes: note || `Transferência interna para o cofrinho ${bank.name}`,
    },
  });

  const piggyTx = await tx.piggyTransaction.create({
    data: {
      piggyBankId: bank.id,
      userId,
      type: 'deposit',
      source,
      amount: depositAmount,
      date: day,
      expenseId: expense.id,
      note,
    },
  });

  const nextBalance = currentBalance.plus(depositAmount);
  const completed =
    goalAmount != null && nextBalance.gte(goalAmount) && !bank.completedAt;
  const updatedBank = await tx.piggyBank.update({
    where: { id: bank.id },
    data: completed ? { completedAt: day } : {},
    include: { transactions: true },
  });

  return {
    bank: updatedBank,
    transaction: piggyTx,
    completed,
    depositAmount: Number(depositAmount),
    alreadyProcessed: false,
  };
}

export async function depositToPiggyBank(params: DepositParams) {
  return withUserWriteLockTransaction(params.userId, (tx) =>
    depositToPiggyBankInTransaction(tx, params),
  );
}

type WithdrawParams = {
  userId: string;
  piggyBankId: string;
  amount: number;
  note?: string | null;
  date?: Date;
};

export async function withdrawFromPiggyBank({
  userId,
  piggyBankId,
  amount,
  note = null,
  date = new Date(),
}: WithdrawParams) {
  const requested = money(amount);
  const day = todayInSaoPaulo(date);

  return withUserWriteLockTransaction(userId, async (tx) => {
    const bank = await tx.piggyBank.findFirst({
      where: { id: piggyBankId, userId },
      include: { transactions: true },
    });
    if (!bank) throw new Error('NOT_FOUND');
    if (bank.archivedAt) throw new Error('ARCHIVED');

    const currentBalance = balanceDecimalFromTransactions(bank.transactions);
    if (requested.gt(currentBalance)) {
      throw new Error('INSUFFICIENT_BALANCE');
    }

    const entry = await tx.entry.create({
      data: {
        userId,
        name: `Resgate · ${bank.name}`,
        amount: requested,
        type: 'outro',
        frequency: 'unica',
        date: day,
        systemOrigin: 'piggy',
      },
    });

    const piggyTx = await tx.piggyTransaction.create({
      data: {
        piggyBankId: bank.id,
        userId,
        type: 'withdraw',
        source: 'manual',
        amount: requested,
        date: day,
        entryId: entry.id,
        note,
      },
    });

    const goalAmount =
      bank.goalAmount == null ? null : decimal(bank.goalAmount);
    const nextBalance = currentBalance.minus(requested);
    const updatedBank = await tx.piggyBank.update({
      where: { id: bank.id },
      data: {
        completedAt:
          goalAmount != null && nextBalance.lt(goalAmount)
            ? null
            : bank.completedAt,
      },
      include: { transactions: true },
    });

    return { bank: updatedBank, transaction: piggyTx, entry };
  });
}

export function parseAutoDebitDay(value: unknown): number | null {
  const day = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
}

export function currentAutoDebitCycle(
  now: Date,
  createdAt: Date,
  autoDebitDay: number,
) {
  const today = todayInSaoPaulo(now);
  const year = today.getUTCFullYear();
  const monthIndex = today.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const dueDay = Math.min(autoDebitDay || 1, lastDay);
  const dueOn = new Date(Date.UTC(year, monthIndex, dueDay, 12));
  const createdDay = todayInSaoPaulo(createdAt);

  if (today < dueOn || createdDay >= dueOn) return null;

  return {
    dueOn,
    monthStart: new Date(Date.UTC(year, monthIndex, 1, 12)),
    monthEnd: new Date(Date.UTC(year, monthIndex, lastDay, 12)),
  };
}

export function hasAutoDebitInCycle(
  transactions: Pick<PiggyTransaction, 'type' | 'source' | 'date'>[],
  cycle: ReturnType<typeof currentAutoDebitCycle>,
) {
  if (!cycle) return false;
  return transactions.some((transaction) => {
    if (transaction.type !== 'deposit' || transaction.source !== 'auto_debit') {
      return false;
    }
    const transactionDay = todayInSaoPaulo(transaction.date);
    return transactionDay >= cycle.monthStart && transactionDay <= cycle.monthEnd;
  });
}

export async function processPiggyAutoDebits(userId: string, now = new Date()) {
  const candidateBanks = await prisma.piggyBank.findMany({
    where: {
      userId,
      autoDebit: true,
      archivedAt: null,
      completedAt: null,
    },
    select: { id: true },
  });
  let createdCount = 0;
  let failedCount = 0;

  for (const { id } of candidateBanks) {
    try {
      const created = await withUserWriteLockTransaction(userId, async (tx) => {
        const bank = await tx.piggyBank.findFirst({
          where: {
            id,
            userId,
            autoDebit: true,
            archivedAt: null,
            completedAt: null,
          },
          include: { transactions: true },
        });
        if (!bank) return false;

        const cycle = currentAutoDebitCycle(now, bank.createdAt, bank.autoDebitDay);
        if (
          !cycle ||
          hasAutoDebitInCycle(bank.transactions, cycle) ||
          bank.monthlyGoal.lte(0)
        ) {
          return false;
        }

        const balance = balanceDecimalFromTransactions(bank.transactions);
        const goalAmount =
          bank.goalAmount == null ? null : decimal(bank.goalAmount);
        let amount = bank.monthlyGoal;
        if (goalAmount != null) {
          const remaining = goalAmount.minus(balance);
          if (remaining.lte(0)) return false;
          if (amount.gt(remaining)) amount = remaining;
        }

        const deposit = await depositToPiggyBankInTransaction(tx, {
          userId,
          piggyBankId: bank.id,
          amount: Number(amount),
          source: 'auto_debit',
          note: 'Débito automático mensal',
          date: cycle.dueOn,
        });
        return !deposit.alreadyProcessed;
      });

      if (created) createdCount += 1;
    } catch (error) {
      failedCount += 1;
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error('[piggy auto-debit] failed', { bankId: id, errorName });
    }
  }

  return { createdCount, failedCount };
}
