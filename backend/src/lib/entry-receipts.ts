import type { Prisma } from '@/generated/prisma/client';

export const entryReceiptInclude = {
  receipts: {
    orderBy: [{ receivedAt: 'asc' as const }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.EntryInclude;
