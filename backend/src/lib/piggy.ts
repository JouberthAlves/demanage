import type { PiggyBank, PiggyTransaction } from '@prisma/client';

import { todayInSaoPaulo } from '@/lib/card-billing';
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

export function computeMonthlyGoal(goalAmount: number, targetDate: Date, from = new Date()) {
  const months = monthsUntilTarget(
    new Date(Date.UTC(from.getFullYear(), from.getMonth(), 1)),
    targetDate,
  );
  return Math.round((goalAmount / months) * 100) / 100;
}

export function balanceFromTransactions(
  transactions: Pick<PiggyTransaction, 'type' | 'amount'>[],
) {
  return transactions.reduce((sum, tx) => {
    const amount = Number(tx.amount);
    return tx.type === 'deposit' ? sum + amount : sum - amount;
  }, 0);
}

export function serializePiggyBank(
  bank: PiggyBank & { transactions?: PiggyTransaction[] },
) {
  const transactions = bank.transactions ?? [];
  const balance = balanceFromTransactions(transactions);
  const goalAmount = Number(bank.goalAmount);
  const monthlyGoal = Number(bank.monthlyGoal);

  return {
    id: bank.id,
    name: bank.name,
    goalAmount,
    targetDate: bank.targetDate.toISOString().slice(0, 10),
    monthlyGoal,
    autoDebit: bank.autoDebit,
    autoDebitDay: bank.autoDebitDay,
    isEmergency: bank.isEmergency,
    archivedAt: bank.archivedAt?.toISOString() ?? null,
    completedAt: bank.completedAt?.toISOString() ?? null,
    balance,
    progress: goalAmount > 0 ? Math.min(balance / goalAmount, 1) : 0,
    remaining: Math.max(goalAmount - balance, 0),
    createdAt: bank.createdAt.toISOString(),
    updatedAt: bank.updatedAt.toISOString(),
  };
}

export function serializePiggyTransaction(tx: PiggyTransaction) {
  return {
    id: tx.id,
    piggyBankId: tx.piggyBankId,
    type: tx.type,
    source: tx.source,
    amount: Number(tx.amount),
    date: tx.date.toISOString().slice(0, 10),
    expenseId: tx.expenseId,
    entryId: tx.entryId,
    note: tx.note,
    createdAt: tx.createdAt.toISOString(),
  };
}

export function parseTargetDate(value: unknown) {
  const date = parseDateOnly(value, 'INVALID_TARGET_DATE');
  if (!date) {
    throw new Error('INVALID_TARGET_DATE');
  }
  return date;
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

  if (!bank) {
    throw new Error('NOT_FOUND');
  }

  if (bank.archivedAt) {
    throw new Error('ARCHIVED');
  }

  const currentBalance = balanceFromTransactions(bank.transactions);
  const goalAmount = Number(bank.goalAmount);
  const remaining = Math.max(goalAmount - currentBalance, 0);

  if (remaining <= 0) {
    throw new Error('ALREADY_COMPLETE');
  }

  const depositAmount = Math.min(amount, remaining);
  const day = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0),
  );

  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        userId,
        name: `Cofrinho · ${bank.name}`,
        amount: depositAmount,
        category: 'cofrinho',
        frequency: 'unica',
        notes: note || `Depósito no cofrinho ${bank.name}`,
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

    const nextBalance = currentBalance + depositAmount;
    const completed = nextBalance >= goalAmount && !bank.completedAt;

    const updatedBank = await tx.piggyBank.update({
      where: { id: bank.id },
      data: completed ? { completedAt: day } : {},
      include: { transactions: true },
    });

    return {
      bank: updatedBank,
      transaction: piggyTx,
      completed,
      depositAmount,
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

  if (!bank) {
    throw new Error('NOT_FOUND');
  }

  if (bank.archivedAt) {
    throw new Error('ARCHIVED');
  }

  const currentBalance = balanceFromTransactions(bank.transactions);
  if (amount > currentBalance) {
    throw new Error('INSUFFICIENT_BALANCE');
  }

  const day = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0),
  );

  const result = await prisma.$transaction(async (tx) => {
    const entry = await tx.entry.create({
      data: {
        userId,
        name: `Resgate · ${bank.name}`,
        amount,
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
        amount,
        date: day,
        entryId: entry.id,
        note,
      },
    });

    const updatedBank = await tx.piggyBank.update({
      where: { id: bank.id },
      data: {
        completedAt:
          currentBalance - amount < Number(bank.goalAmount)
            ? null
            : bank.completedAt,
      },
      include: { transactions: true },
    });

    return {
      bank: updatedBank,
      transaction: piggyTx,
      entry,
    };
  });

  return result;
}

export function parseAutoDebitDay(value: unknown): number | null {
  const day = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
}

/**
 * Auto-débito no dia escolhido (America/Sao_Paulo).
 * Cofres criados neste mês, no dia do débito ou depois, esperam o próximo ciclo.
 */
export async function processPiggyAutoDebits(userId: string) {
  const now = new Date();
  const todaySp = todayInSaoPaulo(now);
  const year = todaySp.getUTCFullYear();
  const monthIndex = todaySp.getUTCMonth();
  const todayDay = todaySp.getUTCDate();
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const monthStart = new Date(Date.UTC(year, monthIndex, 1, 12, 0, 0));
  const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59));

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
      Date.UTC(year, monthIndex, debitDay, 12, 0, 0),
    );
    // Criado no dia do débito ou depois neste mês → próximo ciclo
    if (bank.createdAt.getTime() >= debitInstant.getTime()) {
      continue;
    }

    const already = bank.transactions.some(
      (tx) =>
        tx.type === 'deposit' &&
        tx.source === 'auto_debit' &&
        tx.date >= monthStart &&
        tx.date <= monthEnd,
    );
    if (already) continue;

    const balance = balanceFromTransactions(bank.transactions);
    const remaining = Number(bank.goalAmount) - balance;
    if (remaining <= 0) continue;

    const amount = Math.min(Number(bank.monthlyGoal), remaining);
    if (amount <= 0) continue;

    try {
      await depositToPiggyBank({
        userId,
        piggyBankId: bank.id,
        amount,
        source: 'auto_debit',
        note: 'Débito automático mensal',
        date: now,
      });
      createdCount += 1;
    } catch {
      // ignora falhas pontuais (ex.: já completo)
    }
  }

  return { createdCount };
}
