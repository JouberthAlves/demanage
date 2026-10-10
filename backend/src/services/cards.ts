import { badRequest, notFound } from '@/http/errors';
import {
  parseCardExpiry,
  parseDayOfMonth,
  parseRequiredText,
} from '@/http/parsers';
import {
  chargesTotalForClosing,
  lateOneOffsTotalForClosing,
  todayInSaoPaulo,
} from '@/lib/card-billing';
import { dateOnlyUtc } from '@/lib/decimal';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';
import { parseOptionalCardLimit } from '@/lib/validate';

const CLOSING_DAY_INVALID = 'Fechamento inválido. Use um dia entre 01 e 31';
const CLOSING_DAY_REQUIRED = 'Informe o dia de fechamento do cartão (01-31)';
const NOT_FOUND_MESSAGE = 'Cartão não encontrado';

export type CreateCardInput = {
  name: string;
  limit: number | null;
  closingDay: number;
  expiresAt: Date | null;
};

export type UpdateCardInput = {
  name?: string;
  limit?: number | null;
  closingDay?: number;
  expiresAt?: Date | null;
};

function parseLimit(value: unknown) {
  const parsed = parseOptionalCardLimit(value);
  if (parsed.error) throw badRequest(parsed.error);
  return parsed.value;
}

export function parseCreateCard(
  body: Record<string, unknown>,
): CreateCardInput {
  const name = parseRequiredText(body.name, 100, 'Campo obrigatório: name');
  const expiresAt = parseCardExpiry(body.expiresAt) ?? null;
  const closingDay = parseDayOfMonth(body.closingDay, CLOSING_DAY_INVALID);
  if (closingDay == null) throw badRequest(CLOSING_DAY_REQUIRED);

  return { name, limit: parseLimit(body.limit) ?? null, closingDay, expiresAt };
}

export function parseUpdateCard(
  body: Record<string, unknown>,
): UpdateCardInput {
  const name =
    body.name === undefined
      ? undefined
      : parseRequiredText(body.name, 100, 'Nome inválido');
  const expiresAt = parseCardExpiry(body.expiresAt);
  const closingDay = parseDayOfMonth(body.closingDay, CLOSING_DAY_INVALID);
  if (closingDay === null) throw badRequest(CLOSING_DAY_REQUIRED);

  return { name, limit: parseLimit(body.limit), closingDay, expiresAt };
}

export function listCards(userId: string) {
  return prisma.card.findMany({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

export function createCard(userId: string, input: CreateCardInput) {
  return withUserWriteLockTransaction(userId, (tx) =>
    tx.card.create({ data: { userId, ...input } }),
  );
}

export function updateCard(userId: string, id: string, input: UpdateCardInput) {
  return withUserWriteLockTransaction(userId, async (tx) => {
    const existing = await tx.card.findFirst({
      where: { id, userId, archivedAt: null },
    });
    if (!existing) throw notFound(NOT_FOUND_MESSAGE);

    let pendingClosingDay = existing.pendingClosingDay;
    let pendingClosingDaySetAt = existing.pendingClosingDaySetAt;
    if (input.closingDay !== undefined) {
      if (input.closingDay === existing.closingDay) {
        pendingClosingDay = null;
        pendingClosingDaySetAt = null;
      } else if (input.closingDay !== existing.pendingClosingDay) {
        pendingClosingDay = input.closingDay;
        pendingClosingDaySetAt = todayInSaoPaulo();
      }
    }

    return tx.card.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
        ...(input.closingDay !== undefined
          ? { pendingClosingDay, pendingClosingDaySetAt }
          : {}),
        ...(input.expiresAt !== undefined
          ? { expiresAt: input.expiresAt }
          : {}),
      },
    });
  });
}

/**
 * Arquiva o cartão gerando, antes, a fatura final do ciclo em aberto (inclui
 * compras retroativas lançadas após o fechamento anterior).
 */
export function archiveCard(userId: string, id: string) {
  return withUserWriteLockTransaction(userId, async (tx) => {
    const card = await tx.card.findFirst({
      where: { id, userId, archivedAt: null },
      include: {
        expenses: { include: { splits: true } },
        expenseSplits: {
          where: { kind: 'card' },
          include: { expense: { include: { splits: true } } },
        },
      },
    });
    if (!card) throw notFound(NOT_FOUND_MESSAGE);

    const expenseMap = new Map(
      card.expenses.map((expense) => [expense.id, expense]),
    );
    for (const split of card.expenseSplits) {
      expenseMap.set(split.expense.id, split.expense);
    }

    const today = todayInSaoPaulo();
    const periodStart = card.lastInvoicedOn
      ? dateOnlyUtc(card.lastInvoicedOn)
      : todayInSaoPaulo(card.createdAt);
    const expenses = [...expenseMap.values()];
    const cycleAmount = chargesTotalForClosing(
      expenses,
      card.id,
      today,
      periodStart,
      card.lastInvoicedOn == null,
    );
    const lateAdjustmentAmount =
      card.lastInvoicedOn && card.lastBillingProcessedAt
        ? lateOneOffsTotalForClosing(
            expenses,
            card.id,
            periodStart,
            card.lastBillingProcessedAt,
          )
        : 0;
    const amount = cycleAmount + lateAdjustmentAmount;
    if (amount > 0) {
      await tx.expense.create({
        data: {
          userId,
          cardId: card.id,
          name: `Fatura do cartão ${card.name}`,
          amount,
          category: 'outro',
          frequency: 'unica',
          isInvoice: true,
          occurredAt: today,
          billingPeriodStart: periodStart,
          billingPeriodEnd: today,
          notes:
            lateAdjustmentAmount > 0
              ? 'Fechamento final antes do arquivamento; inclui compras retroativas informadas após o fechamento anterior'
              : 'Fechamento final antes do arquivamento do cartão',
        },
      });
    }

    const archivedAt = new Date();
    return tx.card.update({
      where: { id },
      data: {
        archivedAt,
        lastInvoicedOn: today,
        lastBillingProcessedAt: archivedAt,
      },
    });
  });
}
