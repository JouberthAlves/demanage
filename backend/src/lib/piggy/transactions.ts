import type { Prisma } from '@/generated/prisma/client';
import { dayKeyOfDate, monthBounds, todayInSaoPaulo } from '@/lib/civil-date';
import { decimal } from '@/lib/decimal';
import { PiggyError } from '@/lib/errors';
import { toMoney } from '@/lib/money';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

import { balanceDecimalFromTransactions } from './ledger';

export type DepositParams = {
  userId: string;
  piggyBankId: string;
  amount: number;
  source?: 'manual' | 'auto_debit';
  note?: string | null;
  date?: Date;
};

export async function depositToPiggyBankInTransaction(
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
  const requested = toMoney(amount);
  const day = todayInSaoPaulo(date);

  const bank = await tx.piggyBank.findFirst({
    where: { id: piggyBankId, userId },
    include: { transactions: true },
  });
  if (!bank) throw new PiggyError('NOT_FOUND');
  if (bank.archivedAt) throw new PiggyError('ARCHIVED');

  if (source === 'auto_debit') {
    const key = dayKeyOfDate(day);
    const month = monthBounds(
      Number(key.slice(0, 4)),
      Number(key.slice(5, 7)) - 1,
    );
    const nextMonthStart = new Date(month.end.getTime() + 86_400_000);
    const existingAutoDebit = await tx.piggyTransaction.findFirst({
      where: {
        piggyBankId: bank.id,
        userId,
        source: 'auto_debit',
        type: 'deposit',
        date: { gte: month.start, lt: nextMonthStart },
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
    throw new PiggyError('ALREADY_COMPLETE');
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
  const requested = toMoney(amount);
  const day = todayInSaoPaulo(date);

  return withUserWriteLockTransaction(userId, async (tx) => {
    const bank = await tx.piggyBank.findFirst({
      where: { id: piggyBankId, userId },
      include: { transactions: true },
    });
    if (!bank) throw new PiggyError('NOT_FOUND');
    if (bank.archivedAt) throw new PiggyError('ARCHIVED');

    const currentBalance = balanceDecimalFromTransactions(bank.transactions);
    if (requested.gt(currentBalance)) {
      throw new PiggyError('INSUFFICIENT_BALANCE');
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
