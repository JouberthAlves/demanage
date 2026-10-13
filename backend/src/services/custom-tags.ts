import type { CustomTagScope, Prisma } from '@/generated/prisma/client';
import {
  badRequest,
  conflict,
  isUniqueViolation,
  notFound,
} from '@/http/errors';
import { parseOneOf, parseRequiredText } from '@/http/parsers';
import { prisma } from '@/lib/prisma';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const SCOPES = ['expense', 'income'] as const;

export const INVALID_CUSTOM_TAG_MESSAGE = 'Tipo personalizado inválido';

export const customTagSelect = {
  id: true,
  name: true,
  color: true,
} as const;

export function parseTagScope(value: unknown, message: string): CustomTagScope {
  return parseOneOf(value, SCOPES, message);
}

export type CreateCustomTagInput = {
  scope: CustomTagScope;
  name: string;
  color: string;
};

export function parseCreateCustomTag(
  body: Record<string, unknown>,
): CreateCustomTagInput {
  const scope = parseTagScope(body.scope, 'scope deve ser expense ou income');
  const name = parseRequiredText(body.name, 100, 'Informe o nome do tipo');
  const color = body.color;
  if (typeof color !== 'string' || !HEX_COLOR.test(color)) {
    throw badRequest('Cor inválida (use #RRGGBB)');
  }
  return { scope, name, color };
}

export function listCustomTags(userId: string, scope: CustomTagScope) {
  return prisma.customTag.findMany({
    where: { userId, scope },
    orderBy: { name: 'asc' },
  });
}

export async function createCustomTag(
  userId: string,
  input: CreateCustomTagInput,
) {
  const duplicateMessage = 'Já existe um tipo com esse nome';
  // A unique do banco é case-sensitive; o pré-check cobre variações de caixa
  // e o catch cobre a corrida entre requisições concorrentes.
  const existing = await prisma.customTag.findFirst({
    where: {
      userId,
      scope: input.scope,
      name: { equals: input.name, mode: 'insensitive' },
    },
    select: { id: true },
  });
  if (existing) throw conflict(duplicateMessage);

  try {
    return await prisma.customTag.create({ data: { userId, ...input } });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(duplicateMessage);
    throw error;
  }
}

export async function deleteCustomTag(userId: string, id: string) {
  const { count } = await prisma.customTag.deleteMany({
    where: { id, userId },
  });
  if (count === 0) throw notFound('Tipo não encontrado');
}

/**
 * Resolve o `customTagId` do corpo para um id válido do usuário/escopo.
 * Somente "tag inexistente" vira 400; falhas de banco propagam como 5xx.
 */
export async function resolveCustomTagId(
  db: Pick<Prisma.TransactionClient, 'customTag'>,
  params: {
    userId: string;
    scope: CustomTagScope;
    customTagId: string | null | undefined;
  },
): Promise<string | null> {
  const { userId, scope, customTagId } = params;
  if (customTagId == null || customTagId === '') return null;

  const tag = await db.customTag.findFirst({
    where: { id: customTagId, userId, scope },
    select: { id: true },
  });
  if (!tag) throw badRequest(INVALID_CUSTOM_TAG_MESSAGE);
  return tag.id;
}
