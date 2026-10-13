import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Prisma's default interactive-transaction timeout is 5s, which backfills
 * (card billing, interest catch-up) can exceed on large histories. These are
 * explicit: wait up to 10s for a connection, run up to 60s.
 */
export const USER_WRITE_TX_OPTIONS = {
  maxWait: 10_000,
  timeout: 60_000,
} as const;

export async function withUserWriteLockTransaction<T>(
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { maxWait?: number; timeout?: number } = {},
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
      `;
      return operation(tx);
    },
    { ...USER_WRITE_TX_OPTIONS, ...options },
  );
}
