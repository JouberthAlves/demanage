import type { CustomTagScope } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export async function resolveCustomTagId(params: {
  userId: string;
  scope: CustomTagScope;
  customTagId: string | null | undefined;
}) {
  const { userId, scope, customTagId } = params;

  if (customTagId == null || customTagId === '') {
    return null;
  }

  const tag = await prisma.customTag.findFirst({
    where: { id: customTagId, userId, scope },
  });

  if (!tag) {
    throw new Error('INVALID_CUSTOM_TAG');
  }

  return tag.id;
}

export const customTagSelect = {
  id: true,
  name: true,
  color: true,
} as const;
