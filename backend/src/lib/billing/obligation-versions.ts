import type { ExpenseObligationVersion, Prisma } from '@/generated/prisma/client';

import type { BillableObligationVersion } from './charges';

type ObligationSplit = {
  kind: 'card' | 'pix';
  cardId: string | null;
  amount: string;
  percent: string;
};

type SnapshotSource = {
  kind: string;
  cardId: string | null;
  amount: string | number | { toString(): string };
  percent: string | number | { toString(): string };
};

/** Persist exact allocated cents and percents, never recompute old splits. */
export function obligationSplitSnapshot(splits: SnapshotSource[]): Prisma.InputJsonArray {
  return splits.map((split) => ({
    kind: split.kind,
    cardId: split.cardId,
    amount: String(split.amount),
    percent: String(split.percent),
  }));
}

function isSplit(value: unknown): value is ObligationSplit {
  if (!value || typeof value !== 'object') return false;
  const split = value as Record<string, unknown>;
  return (split.kind === 'card' && typeof split.cardId === 'string' && split.cardId.length > 0 ||
    split.kind === 'pix' && split.cardId === null) &&
    typeof split.amount === 'string' && /^\d+(?:\.\d{1,2})?$/.test(split.amount) &&
    typeof split.percent === 'string' && /^\d+(?:\.\d{1,2})?$/.test(split.percent);
}

/** A corrupt or incomplete snapshot must fail billing, never fall back to live amounts. */
export function parseObligationVersions(rows: ExpenseObligationVersion[]): BillableObligationVersion[] {
  return rows.map((row) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.effectiveMonth) ||
      !Number.isSafeInteger(row.sequence) || row.sequence < 1 ||
      !Array.isArray(row.splits) || !row.splits.every(isSplit)) {
      throw new Error('Invalid persisted expense obligation version');
    }
    const splits = row.splits as ObligationSplit[];
    const sumCents = splits.reduce((sum, split) => sum + Math.round(Number(split.amount) * 100), 0);
    if (splits.length && sumCents !== Math.round(Number(row.amount) * 100)) {
      throw new Error('Persisted expense obligation splits do not match amount');
    }
    return {
      sequence: row.sequence,
      effectiveMonth: row.effectiveMonth,
      amount: row.amount,
      cardId: row.cardId,
      splits: splits.map((split) => ({ kind: split.kind, cardId: split.cardId, amount: split.amount })),
    };
  });
}

/** Legacy records predate versioning. Anchor the original snapshot to the
 * schedule's first month, so a card cycle straddling the edit month still
 * bills old occurrences; never infer or reopen an already-closed invoice. */
export function legacyBaselineMonth(startsAt: Date | null, createdAt: Date): string {
  return (startsAt ?? createdAt).toISOString().slice(0, 7);
}

/** Moving a recurring start backwards invents earlier scheduled obligations.
 * The existing immutable version chain may have no price for those months. */
export function scheduleMovesEarlier(previous: Date | null, next: Date | null | undefined): boolean {
  return previous != null && next != null && next.getTime() < previous.getTime();
}