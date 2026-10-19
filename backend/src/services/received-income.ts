import { Prisma } from '@/generated/prisma/client';
import { badRequest } from '@/http/errors';
import { dayKeyToDate, monthKey, parseDayKey, todayKeyInSaoPaulo } from '@/lib/civil-date';

/** Reusable primitive: caller must own the user-level write lock and transaction. */
export async function createReceivedOneTimeIncomeInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  input: {
    amountCents: number;
    dateKey: string;
    name: string;
    notes: string | null;
    tagId: string | null;
  },
): Promise<{ entryId: string; receiptId: string }> {
  if (
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents < 1 ||
    input.amountCents > 999_999_999_999
  ) {
    throw badRequest('Valor da entrada inválido');
  }
  if (!parseDayKey(input.dateKey)) {
    throw badRequest('Data da entrada inválida');
  }
  if (input.dateKey > todayKeyInSaoPaulo()) {
    throw badRequest('Data futura não pode ser marcada como recebida');
  }
  const name = input.name.trim();
  if (!name || name.length > 100) {
    throw badRequest('Nome da entrada inválido');
  }
  if (input.notes != null && input.notes.length > 500) {
    throw badRequest('Descrição da entrada muito longa');
  }

  if (input.tagId) {
    const tag = await tx.customTag.findFirst({
      where: { id: input.tagId, userId, scope: 'income' },
      select: { id: true },
    });
    if (!tag) throw badRequest('Tag de entrada inválida');
  }

  const date = dayKeyToDate(input.dateKey, 'noon');
  const amount = new Prisma.Decimal(input.amountCents).div(100);
  const entry = await tx.entry.create({
    data: {
      userId,
      name,
      amount,
      type: 'outro',
      frequency: 'unica',
      date,
      customTagId: input.tagId,
      notes: input.notes,
      systemOrigin: 'manual',
    },
  });
  const receipt = await tx.entryReceipt.create({
    data: {
      entryId: entry.id,
      month: monthKey(input.dateKey),
      amount,
      receivedAt: date,
    },
  });
  return { entryId: entry.id, receiptId: receipt.id };
}
