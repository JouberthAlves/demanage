import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

import { entryInclude } from './entries';
import { expenseInclude } from './expenses';

/** Limit for each independently paginated ledger, not the combined response. */
export const FINANCIAL_HISTORY_MAX_PAGE_SIZE = 200;

export class HistoryPageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryPageInputError';
  }
}

export type HistoryPageOptions = {
  limit?: number;
  snapshot?: string;
  expenseCursor?: string;
  incomeCursor?: string;
};

type HistoryCursor = { createdAt: string; id: string };

function parseHistoryCursor(raw: string | undefined): HistoryCursor | null {
  if (raw === undefined || raw === 'end') return null;
  if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new HistoryPageInputError('Invalid financial history cursor');
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      !value || typeof value !== 'object' || Array.isArray(value) ||
      typeof (value as HistoryCursor).id !== 'string' ||
      !(value as HistoryCursor).id || (value as HistoryCursor).id.length > 128 ||
      typeof (value as HistoryCursor).createdAt !== 'string' ||
      !Number.isFinite(Date.parse((value as HistoryCursor).createdAt)) ||
      new Date((value as HistoryCursor).createdAt).toISOString() !== (value as HistoryCursor).createdAt
    ) throw new Error('Malformed cursor');
    return value as HistoryCursor;
  } catch {
    throw new HistoryPageInputError('Invalid financial history cursor');
  }
}

function encodeHistoryCursor(row: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id })).toString('base64url');
}

export function parseFinancialHistoryPageOptions(query: Record<string, unknown>): HistoryPageOptions {
  const allowed = ['limit', 'snapshot', 'expenseCursor', 'incomeCursor'];
  if (Object.keys(query).some((key) => !allowed.includes(key))) {
    throw new HistoryPageInputError('Invalid financial history query');
  }
  for (const key of allowed) {
    if (query[key] !== undefined && (typeof query[key] !== 'string' || !query[key])) {
      throw new HistoryPageInputError('Invalid financial history query');
    }
  }
  const limitText = query.limit as string | undefined;
  if (limitText !== undefined && !/^[1-9]\d{0,2}$/.test(limitText)) {
    throw new HistoryPageInputError('Invalid financial history page limit');
  }
  return {
    ...(limitText ? { limit: Number(limitText) } : {}),
    ...(query.snapshot ? { snapshot: query.snapshot as string } : {}),
    ...(query.expenseCursor ? { expenseCursor: query.expenseCursor as string } : {}),
    ...(query.incomeCursor ? { incomeCursor: query.incomeCursor as string } : {}),
  };
}

/**
 * Keyset pagination capped by request and snapshot. The compound tie-breaker
 * handles simultaneous createdAt values without duplicates or missing rows.
 * Historical (archived) manual parents remain included; voided are excluded.
 * Each page is bounded even when a user has years of recorded receipts.
 */
export async function listFinancialHistoryPage(
  userId: string,
  options: HistoryPageOptions = {},
  db: Pick<typeof prisma, 'expense' | 'entry'> = prisma,
) {
  const limit = options.limit ?? FINANCIAL_HISTORY_MAX_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > FINANCIAL_HISTORY_MAX_PAGE_SIZE) {
    throw new HistoryPageInputError('Invalid financial history page limit');
  }
  const snapshot = options.snapshot ?? new Date().toISOString();
  const cutoff = new Date(snapshot);
  if (
    !Number.isFinite(cutoff.getTime()) || cutoff.toISOString() !== snapshot ||
    cutoff.getTime() > Date.now() + 60_000 || cutoff.getTime() < 0 ||
    ((options.expenseCursor || options.incomeCursor) && !options.snapshot)
  ) {
    throw new HistoryPageInputError('Invalid financial history snapshot');
  }
  const expenseCursor = parseHistoryCursor(options.expenseCursor);
  const incomeCursor = parseHistoryCursor(options.incomeCursor);
  for (const cursor of [expenseCursor, incomeCursor]) {
    if (cursor && new Date(cursor.createdAt) > cutoff) {
      throw new HistoryPageInputError('Invalid financial history cursor snapshot');
    }
  }
  const afterCursor = (cursor: HistoryCursor | null) =>
    cursor ? [{ OR: [
      { createdAt: { lt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
    ] }] : [];
  const [expenseRows, incomeRows] = await Promise.all([
    options.expenseCursor === 'end' ? Promise.resolve([]) : db.expense.findMany({
      where: { AND: [
        { userId, systemOrigin: 'manual', voidedAt: null },
        { createdAt: { lte: cutoff } },
        ...afterCursor(expenseCursor),
      ] },
      include: expenseInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    } satisfies Prisma.ExpenseFindManyArgs),
    options.incomeCursor === 'end' ? Promise.resolve([]) : db.entry.findMany({
      where: { AND: [
        { userId, systemOrigin: 'manual' },
        { createdAt: { lte: cutoff } },
        ...afterCursor(incomeCursor),
      ] },
      include: entryInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    } satisfies Prisma.EntryFindManyArgs),
  ]);
  const expenses = expenseRows.slice(0, limit);
  const incomes = incomeRows.slice(0, limit);
  return {
    snapshot,
    expenses,
    incomes,
    nextExpenseCursor: expenseRows.length > limit ? encodeHistoryCursor(expenses[expenses.length - 1]!) : null,
    nextIncomeCursor: incomeRows.length > limit ? encodeHistoryCursor(incomes[incomes.length - 1]!) : null,
  };
}
