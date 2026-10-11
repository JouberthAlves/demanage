import { decimal } from '@/lib/decimal';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

import { type AutoDebitCycle,hasAutoDebitInCycle, listDueAutoDebitCycles } from './auto-debit';
import { balanceDecimalFromTransactions } from './ledger';
import { depositToPiggyBankInTransaction } from './transactions';

type CycleOutcome = 'created' | 'skipped' | 'stop';

async function processCycle(
  userId: string,
  bankId: string,
  cycle: AutoDebitCycle,
): Promise<CycleOutcome> {
  return withUserWriteLockTransaction(userId, async (tx) => {
    const bank = await tx.piggyBank.findFirst({
      where: {
        id: bankId,
        userId,
        autoDebit: true,
        archivedAt: null,
        completedAt: null,
      },
      include: { transactions: true },
    });
    if (!bank || bank.monthlyGoal.lte(0)) return 'stop';
    if (hasAutoDebitInCycle(bank.transactions, cycle)) return 'skipped';

    let amount = bank.monthlyGoal;
    if (bank.goalAmount != null) {
      const balance = balanceDecimalFromTransactions(bank.transactions);
      const remaining = decimal(bank.goalAmount).minus(balance);
      if (remaining.lte(0)) return 'stop';
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
    return deposit.alreadyProcessed ? 'skipped' : 'created';
  });
}

/**
 * Runs every due auto-debit cycle (current AND missed months, oldest first)
 * for the user's banks. Each cycle is its own transaction and idempotent, and
 * a failing bank never blocks the others.
 */
export async function runPiggyAutoDebits(userId: string, now = new Date()) {
  const candidateBanks = await prisma.piggyBank.findMany({
    where: { userId, autoDebit: true, archivedAt: null, completedAt: null },
    select: {
      id: true,
      createdAt: true,
      autoDebitDay: true,
      autoDebitEnabledAt: true,
    },
  });
  let createdCount = 0;
  const failedBankIds: string[] = [];

  for (const bank of candidateBanks) {
    try {
      const cycles = listDueAutoDebitCycles(
        now,
        bank.createdAt,
        bank.autoDebitDay,
        bank.autoDebitEnabledAt,
      );
      for (const cycle of cycles) {
        const outcome = await processCycle(userId, bank.id, cycle);
        if (outcome === 'created') createdCount += 1;
        if (outcome === 'stop') break;
      }
    } catch (error) {
      failedBankIds.push(bank.id);
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error('[piggy auto-debit] failed', {
        bankId: bank.id,
        errorName,
      });
    }
  }

  return { createdCount, failedBankIds };
}

export async function processPiggyAutoDebits(userId: string, now = new Date()) {
  const { createdCount, failedBankIds } = await runPiggyAutoDebits(userId, now);
  return { createdCount, failedCount: failedBankIds.length };
}
