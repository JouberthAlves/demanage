import type { PiggyBank, PiggyTransaction } from '@prisma/client';

import { todayInSaoPaulo } from '@/lib/card-billing';
import { decimal, money, ZERO } from '@/lib/decimal';
import { parseDateOnly } from '@/lib/entry-schedule';
import { prisma } from '@/lib/prisma';

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
  const months = monthsUntilTarget(
    new Date(Date.UTC(from.getFullYear(), from.getMonth(), 1)),
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
    cdiRate:
      transaction.cdiRate == null ? null : Number(transaction.cdiRate),
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
  return date;
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

export async function depositToPiggyBank({
  userId,
  piggyBankId,
  amount,
  source = 'manual',
  note = null,
  date = new Date(),
}: DepositParams) {
  const bank = await prisma.piggyBank.findFirst({
    where: { id: piggyBankId, userId },
    include: { transactions: true },
  });
  if (!bank) throw new Error('NOT_FOUND');
  if (bank.archivedAt) throw new Error('ARCHIVED');

  const currentBalance = balanceDecimalFromTransactions(bank.transactions);
  const goalAmount =
    bank.goalAmount == null ? null : decimal(bank.goalAmount);
  const remaining =
    goalAmount == null ? null : goalAmount.minus(currentBalance);
  if (remaining != null && remaining.lte(0)) {
    throw new Error('ALREADY_COMPLETE');
  }

  const requested = money(amount);
  const depositAmount =
    remaining == null || requested.lte(remaining) ? requested : remaining;
  const day = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12),
  );

  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        userId,
        name: `Cofrinho · ${bank.name}`,
        amount: depositAmount,
        category: 'investimento',
        frequency: 'unica',
        occurredAt: day,
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
    };
  });

  return result;
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
  const bank = await prisma.piggyBank.findFirst({
    where: { id: piggyBankId, userId },
    include: { transactions: true },
  });
  if (!bank) throw new Error('NOT_FOUND');
  if (bank.archivedAt) throw new Error('ARCHIVED');

  const currentBalance = balanceDecimalFromTransactions(bank.transactions);
  const requested = money(amount);
  if (requested.gt(currentBalance)) {
    throw new Error('INSUFFICIENT_BALANCE');
  }
  const day = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12),
  );

  const result = await prisma.$transaction(async (tx) => {
    const entry = await tx.entry.create({
      data: {
        userId,
        name: `Resgate · ${bank.name}`,
        amount: requested,
        type: 'outro',
        frequency: 'unica',
        date: day,
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

  return result;
}

export function parseAutoDebitDay(value: unknown): number | null {
  const day = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
}

export async function processPiggyAutoDebits(userId: string) {
  const now = new Date();
  const todaySp = todayInSaoPaulo(now);
  const year = todaySp.getUTCFullYear();
  const monthIndex = todaySp.getUTCMonth();
  const todayDay = todaySp.getUTCDate();
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthStart = new Date(Date.UTC(year, monthIndex, 1, 12));
  const monthEnd = new Date(
    Date.UTC(year, monthIndex + 1, 0, 23, 59, 59),
  );

  const banks = await prisma.piggyBank.findMany({
    where: {
      userId,
      autoDebit: true,
      archivedAt: null,
      completedAt: null,
    },
    include: { transactions: true },
  });
  let createdCount = 0;

  for (const bank of banks) {
    const debitDay = Math.min(bank.autoDebitDay || 1, lastDay);
    if (todayDay !== debitDay) continue;
    const debitInstant = new Date(
      Date.UTC(year, monthIndex, debitDay, 12),
    );
    if (bank.createdAt.getTime() >= debitInstant.getTime()) continue;
    const already = bank.transactions.some(
      (transaction) =>
        transaction.type === 'deposit' &&
        transaction.source === 'auto_debit' &&
        transaction.date >= monthStart &&
        transaction.date <= monthEnd,
    );
    if (already) continue;

    const balance = balanceDecimalFromTransactions(bank.transactions);
    const goalAmount =
      bank.goalAmount == null ? null : decimal(bank.goalAmount);
    if (bank.monthlyGoal.lte(0)) continue;
    let amount = bank.monthlyGoal;
    if (goalAmount != null) {
      const remaining = goalAmount.minus(balance);
      if (remaining.lte(0)) continue;
      if (amount.gt(remaining)) amount = remaining;
    }

    try {
      await depositToPiggyBank({
        userId,
        piggyBankId: bank.id,
        amount: Number(amount),
        source: 'auto_debit',
        note: 'Débito automático mensal',
        date: now,
      });
      createdCount += 1;
    } catch {
      // Uma falha pontual não deve interromper os demais cofres.
    }
  }

  return { createdCount };
}
