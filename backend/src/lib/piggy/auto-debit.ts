import type { PiggyTransaction } from '@/generated/prisma/client';
import {
  clampDayToMonth,
  dayKeyInSaoPaulo,
  dayKeyToDate,
  formatDayKey,
  monthBounds,
  parseDayKey,
  todayKeyInSaoPaulo,
} from '@/lib/civil-date';

/** Pure auto-debit cycle maths. DB side: piggy/auto-debit-run.ts. */

export type AutoDebitCycle = {
  dueOn: Date;
  monthStart: Date;
  monthEnd: Date;
};

/** Safety bound on how many missed months one call may back-fill. */
export const MAX_AUTO_DEBIT_CATCH_UP_CYCLES = 60;

function cycleForMonth(
  year: number,
  monthIndex: number,
  todayKey: string,
  createdKey: string,
  autoDebitDay: number,
): AutoDebitCycle | null {
  const bounds = monthBounds(year, monthIndex);
  const dueKey = formatDayKey(
    year,
    monthIndex,
    clampDayToMonth(year, monthIndex, autoDebitDay || 1),
  );
  if (todayKey < dueKey || createdKey >= dueKey) return null;
  return {
    dueOn: dayKeyToDate(dueKey),
    monthStart: bounds.start,
    monthEnd: bounds.end,
  };
}

/** The auto-debit cycle of the CURRENT São Paulo month, if it is due. */
export function currentAutoDebitCycle(
  now: Date,
  createdAt: Date,
  autoDebitDay: number,
) {
  const todayKey = todayKeyInSaoPaulo(now);
  const today = parseDayKey(todayKey)!;
  return cycleForMonth(
    today.year,
    today.monthIndex,
    todayKey,
    dayKeyInSaoPaulo(createdAt),
    autoDebitDay,
  );
}

/**
 * Every due cycle from the bank's creation month through the current month,
 * oldest first (missed months included). Idempotency per cycle is enforced by
 * the caller via hasAutoDebitInCycle.
 */
export function listDueAutoDebitCycles(
  now: Date,
  createdAt: Date,
  autoDebitDay: number,
): AutoDebitCycle[] {
  const todayKey = todayKeyInSaoPaulo(now);
  const createdKey = dayKeyInSaoPaulo(createdAt);
  const today = parseDayKey(todayKey)!;
  const created = parseDayKey(createdKey)!;
  const cycles: AutoDebitCycle[] = [];

  let year = created.year;
  let month = created.monthIndex;
  while (year < today.year || (year === today.year && month <= today.monthIndex)) {
    const cycle = cycleForMonth(year, month, todayKey, createdKey, autoDebitDay);
    if (cycle) cycles.push(cycle);
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return cycles.slice(-MAX_AUTO_DEBIT_CATCH_UP_CYCLES);
}

export function hasAutoDebitInCycle(
  transactions: Pick<PiggyTransaction, 'type' | 'source' | 'date'>[],
  cycle: AutoDebitCycle | null,
) {
  if (!cycle) return false;
  const startKey = dayKeyInSaoPaulo(cycle.monthStart);
  const endKey = dayKeyInSaoPaulo(cycle.monthEnd);
  return transactions.some((transaction) => {
    if (transaction.type !== 'deposit' || transaction.source !== 'auto_debit') {
      return false;
    }
    const key = dayKeyInSaoPaulo(transaction.date);
    return key >= startKey && key <= endKey;
  });
}
