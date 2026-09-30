import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

export async function withUserWriteLockTransaction<T>(
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE
    `;
    return operation(tx);
  });
}
