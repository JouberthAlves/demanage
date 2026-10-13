import { Prisma } from '@/generated/prisma/client';
import { decimal, type DecimalLike, ZERO } from '@/lib/decimal';

/**
 * THE piggy-bank balance function (pure). Previously duplicated in
 * piggy.ts, piggy-interest.ts and patrimony.ts.
 * deposits and interest add, withdrawals subtract.
 */
export type LedgerType = 'deposit' | 'withdraw' | 'interest';

export type LedgerEntry = { type: LedgerType | string; amount: DecimalLike };

export function signedAmount(
  type: LedgerType | string,
  amount: DecimalLike,
): Prisma.Decimal {
  const value = decimal(amount);
  return type === 'withdraw' ? value.negated() : value;
}

export function balanceDecimalFromTransactions(
  transactions: Iterable<LedgerEntry>,
): Prisma.Decimal {
  let balance = ZERO;
  for (const transaction of transactions) {
    balance = balance.plus(signedAmount(transaction.type, transaction.amount));
  }
  return balance;
}

export function balanceFromTransactions(transactions: Iterable<LedgerEntry>) {
  return Number(balanceDecimalFromTransactions(transactions));
}

/** Running totals: prefix[i] = balance after transactions[0..i]. */
export function balancePrefixSums(
  transactions: LedgerEntry[],
): Prisma.Decimal[] {
  const sums: Prisma.Decimal[] = [];
  let balance = ZERO;
  for (const transaction of transactions) {
    balance = balance.plus(signedAmount(transaction.type, transaction.amount));
    sums.push(balance);
  }
  return sums;
}
