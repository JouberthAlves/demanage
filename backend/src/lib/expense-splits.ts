import type { Card, Expense, ExpenseSplit, Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export type SplitInput =
  | { kind: 'card'; cardId: string; percent: number }
  | { kind: 'pix'; percent: number };

export type ResolvedSplit = {
  kind: 'card' | 'pix';
  cardId: string | null;
  percent: number;
  amount: number;
};

export class ExpenseSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseSplitError';
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function allocateSplitAmounts(
  total: number,
  parts: Array<{ kind: 'card' | 'pix'; cardId: string | null; percent: number }>,
): ResolvedSplit[] {
  const amounts = parts.map((part, index) => {
    if (index === parts.length - 1) return 0;
    return roundMoney((total * part.percent) / 100);
  });
  const allocated = amounts.reduce((sum, value) => sum + value, 0);
  amounts[parts.length - 1] = roundMoney(total - allocated);

  return parts.map((part, index) => ({
    kind: part.kind,
    cardId: part.cardId,
    percent: roundMoney(part.percent),
    amount: amounts[index],
  }));
}

export function normalizeSplitInputs(args: {
  splits: unknown;
  cardId: unknown;
}): SplitInput[] | null {
  const { splits, cardId } = args;

  if (splits === undefined) {
    if (cardId) {
      return [{ kind: 'card', cardId: String(cardId), percent: 100 }];
    }
    return null;
  }

  if (splits === null) {
    return [];
  }

  if (!Array.isArray(splits)) {
    throw new ExpenseSplitError('Splits inválidos');
  }

  if (splits.length === 0) {
    return [];
  }

  const normalized: SplitInput[] = splits.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      throw new ExpenseSplitError('Splits inválidos');
    }
    const item = raw as Record<string, unknown>;
    const percent = Number(item.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
      throw new ExpenseSplitError('Percentual inválido (use valores > 0)');
    }

    if (item.kind === 'pix') {
      return { kind: 'pix', percent };
    }

    if (item.kind === 'card' || item.cardId) {
      const id = typeof item.cardId === 'string' ? item.cardId.trim() : '';
      if (!id) throw new ExpenseSplitError('Cartão obrigatório no split');
      return { kind: 'card', cardId: id, percent };
    }

    throw new ExpenseSplitError('Split deve ser cartão ou PIX');
  });

  return normalized;
}

export function validateSplitShape(inputs: SplitInput[]) {
  if (inputs.length === 0) return;

  if (inputs.length > 2) {
    throw new ExpenseSplitError('No máximo 2 partes no split');
  }

  const percentSum = roundMoney(
    inputs.reduce((sum, item) => sum + item.percent, 0),
  );
  if (Math.abs(percentSum - 100) > 0.01) {
    throw new ExpenseSplitError('A soma dos percentuais deve ser 100%');
  }

  const pixCount = inputs.filter((item) => item.kind === 'pix').length;
  const cardInputs = inputs.filter(
    (item): item is Extract<SplitInput, { kind: 'card' }> =>
      item.kind === 'card',
  );

  if (pixCount > 1) {
    throw new ExpenseSplitError('Só é permitido um split PIX');
  }

  if (pixCount === 1 && inputs.length === 1) {
    throw new ExpenseSplitError(
      'PIX 100% não usa split — deixe sem cartão',
    );
  }

  if (pixCount === 1 && cardInputs.length !== 1) {
    throw new ExpenseSplitError('Combine 1 cartão + PIX');
  }

  if (pixCount === 0 && cardInputs.length === 1 && inputs.length === 1) {
    if (Math.abs(cardInputs[0].percent - 100) > 0.01) {
      throw new ExpenseSplitError('Um cartão isolado deve ser 100%');
    }
    return;
  }

  if (pixCount === 0 && cardInputs.length === 2) {
    if (cardInputs[0].cardId === cardInputs[1].cardId) {
      throw new ExpenseSplitError('Escolha dois cartões diferentes');
    }
    return;
  }

  if (pixCount === 0 && cardInputs.length !== 1 && cardInputs.length !== 2) {
    throw new ExpenseSplitError('Splits de cartão inválidos');
  }
}

export async function assertCardsForSplits(args: {
  userId: string;
  inputs: SplitInput[];
}) {
  const cardIds = [
    ...new Set(
      args.inputs
        .filter(
          (item): item is Extract<SplitInput, { kind: 'card' }> =>
            item.kind === 'card',
        )
        .map((item) => item.cardId),
    ),
  ];

  if (cardIds.length === 0) return new Map<string, Card>();

  const cards = await prisma.card.findMany({
    where: { userId: args.userId, id: { in: cardIds } },
  });

  if (cards.length !== cardIds.length) {
    throw new ExpenseSplitError('Cartão inválido');
  }

  const now = Date.now();
  for (const card of cards) {
    if (card.expiresAt && card.expiresAt.getTime() < now) {
      throw new ExpenseSplitError(
        `Cartão vencido (${card.name}). Renove a validade no Perfil.`,
      );
    }
  }

  return new Map(cards.map((card) => [card.id, card]));
}

export async function getCommittedByCard(args: {
  userId: string;
  excludeExpenseId?: string;
}) {
  const splits = await prisma.expenseSplit.findMany({
    where: {
      kind: 'card',
      cardId: { not: null },
      expense: {
        userId: args.userId,
        isInvoice: false,
        ...(args.excludeExpenseId
          ? { id: { not: args.excludeExpenseId } }
          : {}),
      },
    },
    select: { cardId: true, amount: true },
  });

  const map = new Map<string, number>();
  for (const split of splits) {
    if (!split.cardId) continue;
    map.set(
      split.cardId,
      (map.get(split.cardId) ?? 0) + Number(split.amount),
    );
  }
  return map;
}

export function assertCardLimits(args: {
  cards: Map<string, Card>;
  resolved: ResolvedSplit[];
  committedByCard: Map<string, number>;
}) {
  for (const split of args.resolved) {
    if (split.kind !== 'card' || !split.cardId) continue;
    const card = args.cards.get(split.cardId);
    if (!card || card.limit == null) continue;

    const limit = Number(card.limit);
    const committed = args.committedByCard.get(split.cardId) ?? 0;
    const available = roundMoney(limit - committed);

    if (split.amount > available + 0.001) {
      throw new ExpenseSplitError(
        `Limite insuficiente no cartão ${card.name} (disponível R$ ${available.toFixed(2).replace('.', ',')})`,
      );
    }
  }
}

export function denormalizedCardId(resolved: ResolvedSplit[]): string | null {
  const cardSplits = resolved.filter((item) => item.kind === 'card');
  if (cardSplits.length === 1 && resolved.length === 1) {
    return cardSplits[0].cardId;
  }
  return null;
}

export function serializeExpenseSplits(
  splits: Array<
    ExpenseSplit & { card?: Pick<Card, 'id' | 'name'> | null }
  >,
) {
  return splits.map((split) => ({
    id: split.id,
    kind: split.kind,
    cardId: split.cardId,
    percent: Number(split.percent),
    amount: Number(split.amount),
    cardName: split.card?.name ?? null,
  }));
}

export const expenseSplitInclude = {
  splits: {
    include: { card: { select: { id: true, name: true } } },
    orderBy: [{ kind: 'asc' as const }, { percent: 'desc' as const }],
  },
} satisfies Prisma.ExpenseInclude;

export function serializeExpense(
  expense: Expense & {
    customTag?: unknown;
    splits?: Array<
      ExpenseSplit & { card?: Pick<Card, 'id' | 'name'> | null }
    >;
  },
) {
  return {
    ...expense,
    amount: Number(expense.amount),
    splits: serializeExpenseSplits(expense.splits ?? []),
  };
}

export async function replaceExpenseSplits(args: {
  tx: Prisma.TransactionClient;
  expenseId: string;
  resolved: ResolvedSplit[];
}) {
  await args.tx.expenseSplit.deleteMany({ where: { expenseId: args.expenseId } });

  if (args.resolved.length === 0) return;

  await args.tx.expenseSplit.createMany({
    data: args.resolved.map((split) => ({
      expenseId: args.expenseId,
      kind: split.kind,
      cardId: split.cardId,
      percent: split.percent,
      amount: split.amount,
    })),
  });
}

export async function resolveAndValidateSplits(args: {
  userId: string;
  totalAmount: number;
  splits: unknown;
  cardId: unknown;
  excludeExpenseId?: string;
}): Promise<ResolvedSplit[]> {
  const inputs = normalizeSplitInputs({
    splits: args.splits,
    cardId: args.cardId,
  });

  if (inputs == null) {
    // splits omitted and no cardId → no card / no splits
    return [];
  }

  validateSplitShape(inputs);
  const cards = await assertCardsForSplits({
    userId: args.userId,
    inputs,
  });

  const resolved = allocateSplitAmounts(
    args.totalAmount,
    inputs.map((item) =>
      item.kind === 'pix'
        ? { kind: 'pix', cardId: null, percent: item.percent }
        : { kind: 'card', cardId: item.cardId, percent: item.percent },
    ),
  );

  const committedByCard = await getCommittedByCard({
    userId: args.userId,
    excludeExpenseId: args.excludeExpenseId,
  });

  assertCardLimits({ cards, resolved, committedByCard });
  return resolved;
}
