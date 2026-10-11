import { Prisma } from '@/generated/prisma/client';
import {
  addDaysToKey,
  type DayKey,
  dayKeyInSaoPaulo,
  dayKeyOfDate,
  dayKeyToDate,
  todayKeyInSaoPaulo,
  weekdayOfKey,
} from '@/lib/civil-date';
import { decimal, type DecimalLike, ZERO } from '@/lib/decimal';
import { MAX_HISTORY_RANGE_DAYS } from '@/lib/market/types';
import { toMoney } from '@/lib/money';

import { balancePrefixSums, type LedgerEntry } from './ledger';

/**
 * Pure CDI interest maths.
 *
 * Accrual is EXACT: each business day the interest on the exact balance
 * (posted cents + carried sub-cent fraction) is computed to 8 decimals; only
 * whole cents are posted and the remainder is carried to the next day.
 *
 * Where the carry lives (no schema change): every posted interest row stores
 * baseBalance/resultingBalance (Decimal(18,8)) as the EXACT balance. The carry
 * after that row is `resultingBalance - sum(all rows up to it)`. Days that
 * post nothing are not marked as processed (interestAccruedThrough only
 * advances to the last day whose carry is persisted, or is zero), so the next
 * run replays them from cached CDI data and reaches the same result.
 * Legacy rows (resultingBalance == cents balance) yield a carry of 0.
 */

/**
 * One day's interest rounded to cents. Kept for display/back-compat; the
 * accrual itself uses the exact 8dp value (see accrueCdiInterest).
 */
export function calculateCdiInterest(
  balance: Prisma.Decimal,
  dailyRatePercent: Prisma.Decimal,
  cdiPercent: Prisma.Decimal,
) {
  return toMoney(exactCdiInterest(balance, dailyRatePercent, cdiPercent));
}

/** balance * daily CDI % * (cdiPercent % of CDI), rounded HALF_UP to 8dp. */
export function exactCdiInterest(
  balance: Prisma.Decimal,
  dailyRatePercent: Prisma.Decimal,
  cdiPercent: Prisma.Decimal,
) {
  if (balance.lte(0) || dailyRatePercent.lte(0) || cdiPercent.lte(0)) {
    return ZERO;
  }
  return balance
    .mul(dailyRatePercent)
    .div(100)
    .mul(cdiPercent)
    .div(100)
    .toDecimalPlaces(8, Prisma.Decimal.ROUND_HALF_UP);
}

export function lastCompletedWeekday(now = new Date()) {
  let key = addDaysToKey(todayKeyInSaoPaulo(now), -1);
  while (weekdayOfKey(key) === 0 || weekdayOfKey(key) === 6) {
    key = addDaysToKey(key, -1);
  }
  return dayKeyToDate(key);
}

export function splitCdiHistoryRange(from: Date, to: Date) {
  const ranges: Array<{ from: string; to: string }> = [];
  let cursor = dayKeyOfDate(from);
  const lastKey = dayKeyOfDate(to);
  while (cursor <= lastKey) {
    const maxEnd = addDaysToKey(cursor, MAX_HISTORY_RANGE_DAYS - 1);
    const end = maxEnd < lastKey ? maxEnd : lastKey;
    ranges.push({ from: cursor, to: end });
    cursor = addDaysToKey(end, 1);
  }
  return ranges;
}

export type InterestLedgerTransaction = LedgerEntry & {
  date: Date;
  interestKey: string | null;
  resultingBalance: DecimalLike | null;
};

export type InterestPosting = {
  day: DayKey;
  interestKey: string;
  /** Whole cents actually posted. */
  amount: Prisma.Decimal;
  rate: Prisma.Decimal;
  /** Exact balance (cents + carry) the day's interest was computed on. */
  baseBalance: Prisma.Decimal;
  /** Exact balance after the day's interest (includes the new carry). */
  resultingBalance: Prisma.Decimal;
};

export type InterestAccrual = {
  postings: InterestPosting[];
  /** New value for PiggyBank.interestAccruedThrough (null = unchanged/none). */
  accruedThrough: DayKey | null;
  /** Sub-cent fraction carried after the last processed day. */
  carry: Prisma.Decimal;
};

const CENT = ZERO.plus('0.01');

/**
 * Replays CDI accrual for one bank.
 * `transactions` must be sorted by (date, createdAt) ascending and contain
 * every ledger row of the bank (deposits, withdrawals, previous interest).
 */
export function accrueCdiInterest(args: {
  bankId: string;
  transactions: InterestLedgerTransaction[];
  accruedThrough: DayKey | null;
  points: Array<{ date: string; value: DecimalLike }>;
  cdiPercent: DecimalLike;
  startKey: DayKey;
  targetKey: DayKey;
}): InterestAccrual {
  const { transactions, bankId } = args;
  const percent = decimal(args.cdiPercent);
  const days = transactions.map((transaction) =>
    dayKeyInSaoPaulo(transaction.date),
  );
  const prefix = balancePrefixSums(transactions);
  const indexByKey = new Map<string, number>();
  transactions.forEach((transaction, index) => {
    if (transaction.interestKey) indexByKey.set(transaction.interestKey, index);
  });

  const carryAfter = (index: number): Prisma.Decimal => {
    const resulting = transactions[index].resultingBalance;
    if (resulting == null) return ZERO;
    const carry = decimal(resulting).minus(prefix[index]);
    return carry.lt(0) || carry.gte(CENT) ? ZERO : carry;
  };

  let carry = ZERO;
  if (args.accruedThrough) {
    for (let index = transactions.length - 1; index >= 0; index -= 1) {
      if (days[index] < args.accruedThrough) break;
      if (
        days[index] === args.accruedThrough &&
        transactions[index].type === 'interest'
      ) {
        carry = carryAfter(index);
        break;
      }
    }
  }

  const points = args.points
    .filter(
      (point) => point.date >= args.startKey && point.date <= args.targetKey,
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const postings: InterestPosting[] = [];
  let accruedThrough: DayKey | null = null;
  let postedSum = ZERO;
  let cursor = 0;

  for (const point of points) {
    const day = point.date;
    while (cursor < transactions.length && days[cursor] <= day) cursor += 1;
    const interestKey = `${bankId}:${day}`;

    const existing = indexByKey.get(interestKey);
    if (existing !== undefined) {
      carry = carryAfter(existing);
      accruedThrough = day;
      continue;
    }

    const postedBalance = (cursor > 0 ? prefix[cursor - 1] : ZERO).plus(
      postedSum,
    );
    const exactBase = postedBalance.plus(carry);
    const rate = decimal(point.value);
    const interest = exactCdiInterest(exactBase, rate, percent);
    const total = carry.plus(interest);
    const cents = total.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    carry = total.minus(cents);

    if (cents.gt(0)) {
      postings.push({
        day,
        interestKey,
        amount: cents,
        rate,
        baseBalance: exactBase,
        resultingBalance: exactBase.plus(interest),
      });
      postedSum = postedSum.plus(cents);
    }
    if (cents.gt(0) || carry.isZero()) accruedThrough = day;
  }

  return { postings, accruedThrough, carry };
}
