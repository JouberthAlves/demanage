import type { Prisma } from '@/generated/prisma/client';
import { badRequest } from '@/http/errors';

const DEFAULT_INCOME_TAG_COLOR = '#34D399';

/**
 * The predicate must match the PostgreSQL 18 expression index in
 * 20261016194000_income_tag_casefold_unique (ICU Unicode casefold + NFKC).
 * The caller owns the surrounding transaction and, normally, the user row lock.
 */
export async function resolveIncomeTagInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  tagName: string,
): Promise<{ id: string; created: boolean }> {
  if (typeof tagName !== 'string') {
    throw badRequest('Nome da tag de entrada inválido (máximo 100 caracteres)');
  }

  const name = tagName.trim().normalize('NFC');
  if (!name || Array.from(name).length > 100 || /\p{C}/u.test(name)) {
    throw badRequest('Nome da tag de entrada inválido (máximo 100 caracteres)');
  }

  // Select by the same DB key used by the partial unique index; Prisma's
  // `mode: insensitive` is insufficient for canonical Unicode equivalents.
  const findEquivalent = () =>
    tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "CustomTag"
      WHERE "userId" = ${userId} AND "scope" = 'income'::"CustomTagScope"
        AND normalize(casefold(normalize("name", NFKC) COLLATE "und-x-icu"), NFKC)
          = normalize(casefold(normalize(${name}::text, NFKC) COLLATE "und-x-icu"), NFKC)
      LIMIT 1
    `;

  const existing = await findEquivalent();
  if (existing[0]) return { id: existing[0].id, created: false };

  // ON CONFLICT DO NOTHING is safe inside an existing interactive transaction:
  // an ordinary P2002 would abort that transaction before we could re-read.
  // The partial functional unique index handles even competing unlocked calls.
  const inserted = await tx.customTag.createMany({
    data: { userId, scope: 'income', name, color: DEFAULT_INCOME_TAG_COLOR },
    skipDuplicates: true,
  });
  const matched = await findEquivalent();
  if (!matched[0]) {
    throw new Error('Created or concurrent income tag could not be resolved');
  }
  return { id: matched[0].id, created: inserted.count === 1 };
}
