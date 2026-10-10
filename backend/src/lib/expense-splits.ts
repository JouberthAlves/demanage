import type {
  Card,
  Expense,
  ExpensePayment,
  ExpenseSplit,
  Prisma,
} from '@/generated/prisma/client';
import { nextClosingOnOrAfter } from '@/lib/billing/calendar';
import {
  chargesTotalDecimal,
  lateOneOffsDecimal,
} from '@/lib/billing/charges';
import {
  dayKeyInSaoPaulo,
  dayKeyOfDate,
  dayKeyToDate,
  todayKeyInSaoPaulo,
} from '@/lib/civil-date';
import { prisma } from '@/lib/prisma';
import {
  allocateSplitAmounts,
  assertCardLimits,
  denormalizedCardId,
  ExpenseSplitError,
  normalizeSplitInputs,
  type ResolvedSplit,
  type SplitInput,
  validateSplitShape,
} from '@/lib/split-allocation';

// Pure split logic lives in lib/split-allocation.ts; re-exported for callers.
export {
  allocateSplitAmounts,
  assertCardLimits,
  denormalizedCardId,
  ExpenseSplitError,
  normalizeSplitInputs,
  type ResolvedSplit,
  type SplitInput,
  validateSplitShape,
};

export async function assertCardsForSplits(args: {
  userId: string;
  inputs: SplitInput[];
  tx?: Prisma.TransactionClient;
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

  const db = args.tx ?? prisma;
  const cards = await db.card.findMany({
    where: {
      userId: args.userId,
      archivedAt: null,
      id: { in: cardIds },
    },
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

/**
 * Amount already committed on each card in the cycle that is open now:
 * every charge dated after the last invoice up to the NEXT closing (so a
 * monthly/weekly charge later in the cycle still reserves limit), plus late
 * one-off adjustments that the next invoice will pick up.
 */
export async function getCommittedByCard(args: {
  userId: string;
  excludeExpenseId?: string;
  tx?: Prisma.TransactionClient;
}) {
  const db = args.tx ?? prisma;
  const [cards, expenses] = await Promise.all([
    db.card.findMany({ where: { userId: args.userId, archivedAt: null } }),
    db.expense.findMany({
      where: {
        userId: args.userId,
        isInvoice: false,
        systemOrigin: 'manual',
        ...(args.excludeExpenseId
          ? { id: { not: args.excludeExpenseId } }
          : {}),
      },
      include: { splits: true },
    }),
  ]);
  const todayKey = todayKeyInSaoPaulo();
  const map = new Map<string, number>();
  for (const card of cards) {
    const periodStartKey = card.lastInvoicedOn
      ? dayKeyOfDate(card.lastInvoicedOn)
      : dayKeyInSaoPaulo(card.createdAt);
    const minimumKey = card.minimumNextClosingOn
      ? dayKeyOfDate(card.minimumNextClosingOn)
      : todayKey;
    const closingKey = nextClosingOnOrAfter(
      card.closingDay,
      periodStartKey,
      minimumKey > todayKey ? minimumKey : todayKey,
    );
    const cycleAmount = chargesTotalDecimal(expenses, card.id, {
      periodStartKey,
      closingKey,
      includePeriodStart: card.lastInvoicedOn == null,
    });
    const lateAdjustment =
      card.lastInvoicedOn && card.lastBillingProcessedAt
        ? lateOneOffsDecimal(
            expenses,
            card.id,
            dayKeyToDate(periodStartKey),
            card.lastBillingProcessedAt,
          )
        : null;
    map.set(
      card.id,
      (lateAdjustment ? cycleAmount.plus(lateAdjustment) : cycleAmount).toNumber(),
    );
  }
  return map;
}

export function serializeExpenseSplits(
  splits: Array<ExpenseSplit & { card?: Pick<Card, 'id' | 'name'> | null }>,
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
  payments: {
    orderBy: [{ paidAt: 'asc' as const }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.ExpenseInclude;

export function serializeExpense(
  expense: Expense & {
    customTag?: unknown;
    splits?: Array<ExpenseSplit & { card?: Pick<Card, 'id' | 'name'> | null }>;
    payments?: ExpensePayment[];
  },
) {
  return {
    ...expense,
    amount: Number(expense.amount),
    splits: serializeExpenseSplits(expense.splits ?? []),
    payments: expense.payments?.map((payment) => ({
      ...payment,
      amount: Number(payment.amount),
    })),
  };
}

export async function replaceExpenseSplits(args: {
  tx: Prisma.TransactionClient;
  expenseId: string;
  resolved: ResolvedSplit[];
}) {
  await args.tx.expenseSplit.deleteMany({
    where: { expenseId: args.expenseId },
  });

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
  tx?: Prisma.TransactionClient;
  validateLimits?: boolean;
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
    tx: args.tx,
  });

  const resolved = allocateSplitAmounts(
    args.totalAmount,
    inputs.map((item) =>
      item.kind === 'pix'
        ? { kind: 'pix', cardId: null, percent: item.percent }
        : { kind: 'card', cardId: item.cardId, percent: item.percent },
    ),
  );

  if (args.validateLimits !== false) {
    const committedByCard = await getCommittedByCard({
      userId: args.userId,
      excludeExpenseId: args.excludeExpenseId,
      tx: args.tx,
    });

    assertCardLimits({ cards, resolved, committedByCard });
  }
  return resolved;
}
