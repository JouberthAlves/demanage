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
  deductFromBalance?: boolean;
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
    deductFromBalance = true,
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

  // Automatic deposits always debit cash. Manual deposits can represent funds
  // already accounted for elsewhere; never create a duplicate expense then.
  const shouldDeduct = source === 'auto_debit' || deductFromBalance;
  const expense = shouldDeduct
    ? await tx.expense.create({
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
      })
    : null;

  const piggyTx = await tx.piggyTransaction.create({
    data: {
      piggyBankId: bank.id,
      userId,
      type: 'deposit',
      source,
      amount: depositAmount,
      date: day,
      expenseId: expense?.id ?? null,
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
  creditToBalance?: boolean;
  correctionOrigin?: 'debited' | 'not_debited';
  note?: string | null;
  date?: Date;
};

const CORRECTION_PREFIX = 'Correção de saldo incorreto';

async function validateCorrectionSource(
  tx: Prisma.TransactionClient,
  bank: Awaited<ReturnType<typeof tx.piggyBank.findFirst>> & { transactions: Array<{
    type: string;
    source: string;
    amount: Prisma.Decimal;
    expenseId: string | null;
    entryId: string | null;
    note: string | null;
  }> },
  requested: Prisma.Decimal,
  origin: 'debited' | 'not_debited',
  userId: string,
) {
  if (bank.yieldEnabled || bank.interestAccruedThrough ||
      bank.transactions.some((item) => item.type === 'interest')) {
    throw new PiggyError('CORRECTION_YIELD_BLOCKED');
  }
  // Automatic deposits may still be pending. Corrections deliberately skip
  // catch-up; accepting one for an auto-debit bank would risk stale source data.
  if (bank.autoDebit || bank.transactions.some((item) =>
    item.type === 'deposit' && item.source !== 'manual')) {
    throw new PiggyError('CORRECTION_ORIGIN_AMBIGUOUS');
  }

  let spentDebited = decimal(0);
  let spentNotDebited = decimal(0);
  for (const movement of bank.transactions) {
    if (movement.type !== 'withdraw') continue;
    if (movement.note?.startsWith(CORRECTION_PREFIX + ' [origem:debited]') &&
      movement.entryId) {
      spentDebited = spentDebited.plus(movement.amount);
    } else if (movement.note?.startsWith(CORRECTION_PREFIX + ' [origem:not_debited]') &&
      !movement.entryId) {
      spentNotDebited = spentNotDebited.plus(movement.amount);
    } else {
      // Old or ordinary withdrawals have no source allocation. Without a
      // source link, a compensating credit might create artificial cash.
      throw new PiggyError('CORRECTION_ORIGIN_AMBIGUOUS');
    }
  }
  const linkedDeposits = bank.transactions.filter((item) =>
    item.type === 'deposit' && item.expenseId !== null);
  const linkedExpenseIds = linkedDeposits.map((item) => item.expenseId!);
  const linkedExpenses = await tx.expense.findMany({
    where: { id: { in: linkedExpenseIds }, userId, systemOrigin: 'piggy', archivedAt: null },
    select: { id: true, amount: true, category: true, frequency: true },
  });
  const linkedExpenseById = new Map(linkedExpenses.map((expense) => [expense.id, expense]));
  let totalDebited = decimal(0);
  let totalNotDebited = decimal(0);
  for (const deposit of bank.transactions) {
    if (deposit.type !== 'deposit') continue;
    if (deposit.expenseId === null) {
      totalNotDebited = totalNotDebited.plus(deposit.amount);
    } else {
      const expense = linkedExpenseById.get(deposit.expenseId);
      if (!expense || expense.category !== 'cofrinho' ||
          expense.frequency !== 'unica' || !expense.amount.equals(deposit.amount)) {
        throw new PiggyError('CORRECTION_ORIGIN_AMBIGUOUS');
      }
      totalDebited = totalDebited.plus(deposit.amount);
    }
  }

  const available = origin === 'debited'
    ? totalDebited.minus(spentDebited)
    : totalNotDebited.minus(spentNotDebited);
  if (available.lt(requested)) throw new PiggyError('CORRECTION_ORIGIN_INSUFFICIENT');
}

export async function withdrawFromPiggyBank({
  userId,
  piggyBankId,
  amount,
  creditToBalance = true,
  correctionOrigin,
  note = null,
  date = new Date(),
}: WithdrawParams) {
  const requested = toMoney(amount);
  const day = todayInSaoPaulo(date);
  if ((!creditToBalance) !== (correctionOrigin !== undefined)) {
    throw new PiggyError('CORRECTION_ORIGIN_AMBIGUOUS');
  }

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

    if (correctionOrigin) {
      await validateCorrectionSource(tx, bank, requested, correctionOrigin, userId);
    }
    const entry = (creditToBalance || correctionOrigin === 'debited')
      ? await tx.entry.create({
          data: {
            userId,
            name: correctionOrigin === 'debited'
              ? `Estorno de depósito · ${bank.name}` : `Resgate · ${bank.name}`,
            amount: requested,
            type: 'outro',
            frequency: 'unica',
            date: day,
            systemOrigin: 'piggy',
            ...(correctionOrigin === 'debited' ? {
              notes: CORRECTION_PREFIX + ' [origem:debited] (reversão do débito do depósito)',
            } : {}),
          },
        })
      : null;

    const piggyTx = await tx.piggyTransaction.create({
      data: {
        piggyBankId: bank.id,
        userId,
        type: 'withdraw',
        source: 'manual',
        amount: requested,
        date: day,
        entryId: entry?.id ?? null,
        note: correctionOrigin
          ? CORRECTION_PREFIX + ' [origem:' + correctionOrigin + ']' +
            (note ? ' · ' + note : '')
          : note,
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
