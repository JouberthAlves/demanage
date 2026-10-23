import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

import { entryInclude } from './entries';
import { expenseInclude } from './expenses';

/**
 * Read-only source for historical ledgers. Archived manual parents retain their
 * recorded payments/receipts; the normal CRUD lists remain active-only.
 * Internal asset/piggy rows have separate cash sources and must not be counted twice.
 */
export async function listFinancialHistory(
  userId: string,
  db: Pick<typeof prisma, 'expense' | 'entry'> = prisma,
) {
  const [expenses, incomes] = await Promise.all([
    db.expense.findMany({
      where: { userId, systemOrigin: 'manual' },
      include: expenseInclude,
      orderBy: { createdAt: 'desc' },
    } satisfies Prisma.ExpenseFindManyArgs),
    db.entry.findMany({
      where: { userId, systemOrigin: 'manual' },
      include: entryInclude,
      orderBy: { createdAt: 'desc' },
    } satisfies Prisma.EntryFindManyArgs),
  ]);
  return { expenses, incomes };
}
