import type { PiggyBank, PiggyTransaction } from '@/generated/prisma/client';
import {
  dayKeyOfDate,
  dayKeyToDate,
  formatDayKey,
  parseCivilDate,
  todayInSaoPaulo,
} from '@/lib/civil-date';
import { decimal } from '@/lib/decimal';
import { PiggyError } from '@/lib/errors';
import { toMoney } from '@/lib/money';

import { balanceFromTransactions } from './ledger';

export function monthsUntilTarget(from: Date, targetDate: Date) {
  const months =
    (targetDate.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (targetDate.getUTCMonth() - from.getUTCMonth());
  return Math.max(1, months);
}

export function piggyGoalAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

/** goal / months, rounded HALF_UP to cents (R$ 0,29 / 2 = 0,15). */
export function computeMonthlyGoal(
  goalAmount: number | null,
  targetDate: Date | null,
  from = new Date(),
) {
  if (!goalAmount || goalAmount <= 0 || !targetDate) return 0;
  const today = todayInSaoPaulo(from);
  const months = monthsUntilTarget(
    dayKeyToDate(formatDayKey(today.getUTCFullYear(), today.getUTCMonth(), 1)),
    targetDate,
  );
  return toMoney(decimal(goalAmount).div(months)).toNumber();
}

export function parseAutoDebitDay(value: unknown): number | null {
  const day = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return day;
}

/** Target dates are ledger dates: strict parse, stored at NOON UTC. */
export function parseTargetDate(value: unknown) {
  const date = parseCivilDate(value, 'noon');
  if (!date) throw new PiggyError('INVALID_TARGET_DATE');
  if (date < todayInSaoPaulo()) throw new PiggyError('PAST_TARGET_DATE');
  return date;
}

export function parseOptionalTargetDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  return parseTargetDate(value);
}

/** Interest rows keep an exact (8dp) balance; the API only shows cents. */
function cents(value: PiggyTransaction['baseBalance']) {
  return value == null ? null : toMoney(value).toNumber();
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
    targetDate: bank.targetDate ? dayKeyOfDate(bank.targetDate) : null,
    monthlyGoal,
    autoDebit: bank.autoDebit,
    autoDebitDay: bank.autoDebitDay,
    isEmergency: bank.isEmergency,
    yieldEnabled: Boolean(bank.yieldEnabled),
    cdiPercent: Number.isFinite(Number(bank.cdiPercent))
      ? Number(bank.cdiPercent)
      : 0,
    interestAccruedThrough: bank.interestAccruedThrough
      ? dayKeyOfDate(bank.interestAccruedThrough)
      : null,
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
    date: dayKeyOfDate(transaction.date),
    expenseId: transaction.expenseId,
    entryId: transaction.entryId,
    note: transaction.note,
    cdiRate: transaction.cdiRate == null ? null : Number(transaction.cdiRate),
    cdiPercent:
      transaction.cdiPercent == null ? null : Number(transaction.cdiPercent),
    baseBalance: cents(transaction.baseBalance),
    resultingBalance: cents(transaction.resultingBalance),
    createdAt: transaction.createdAt.toISOString(),
  };
}
