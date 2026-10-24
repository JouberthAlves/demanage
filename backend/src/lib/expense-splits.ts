import {
  type Card,
  type Expense,
  type ExpensePayment,
  type ExpenseSplit,
  Prisma,
} from '@/generated/prisma/client';
import {
  type BillableExpense,
  chargeAmountDecimal,
  chargesTotalDecimal,
  type CycleWindow,
  lateOneOffsDecimal,
} from '@/lib/billing/charges';
import { currentCycleWindow } from '@/lib/billing/cycle-window';
import { parseObligationVersions } from '@/lib/billing/obligation-versions';
import { dayKeyToDate, todayKeyInSaoPaulo } from '@/lib/civil-date';
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
  asOf?: Date;
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
      include: {
        splits: true,
        obligationVersions: { orderBy: { sequence: 'asc' } },
      },
    }),
  ]);
  // An edit can move the live split while an older month's obligation is
  // still in the open card cycle. Use the same persisted versions as billing.
  const billable = expenses.map((expense) => ({
    ...expense,
    obligationVersions: parseObligationVersions(expense.obligationVersions),
  }));
  const todayKey = todayKeyInSaoPaulo(args.asOf);
  const map = new Map<string, number>();
  for (const card of cards) {
    const window = currentCycleWindow(card, todayKey);
    const periodStartKey = window.periodStartKey;
    const cycleAmount = chargesTotalDecimal(billable, card.id, window);
    const lateAdjustment =
      card.lastInvoicedOn && card.lastBillingProcessedAt
        ? lateOneOffsDecimal(
            billable,
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

/** The edited expense is absent from otherCommittedByCard. Its projected
 * versions include every old open-cycle charge and the new terms once.
 * The full-cycle minimum for new splits is checked separately. */
export function assertProspectiveVersionedCardLimits(args: {
  cards: Card[];
  otherCommittedByCard: Map<string, number>;
  prospective: BillableExpense;
  asOf: Date;
}) {
  const todayKey = todayKeyInSaoPaulo(args.asOf);
  for (const card of args.cards) {
    if (card.limit == null) continue;
    const window = currentCycleWindow(card, todayKey);
    const projected = chargeAmountDecimal(args.prospective, card.id, window);
    // An unrelated overdrawn card must not block a cash-only or other-card
    // schedule edit. Positive projected charges still require full headroom.
    if (projected.lte(0)) continue;
    const available = new Prisma.Decimal(card.limit).minus(
      args.otherCommittedByCard.get(card.id) ?? 0,
    );
    if (projected.gt(available)) {
      throw new ExpenseSplitError(
        `Limite insuficiente no cartão ${card.name} (disponível R$ ${available.toFixed(2).replace('.', ',')})`,
      );
    }
  }
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
  /** unica | semanal | mensal: drives how many charges a cycle must fit. */
  frequency: string;
  excludeExpenseId?: string;
  tx?: Prisma.TransactionClient;
  validateLimits?: boolean;
  asOf?: Date;
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
      asOf: args.asOf,
    });

    const todayKey = todayKeyInSaoPaulo(args.asOf);
    const windows = new Map<string, CycleWindow>(
      [...cards.values()].map((card) => [
        card.id,
        currentCycleWindow(card, todayKey),
      ]),
    );

    assertCardLimits({
      cards,
      resolved,
      committedByCard,
      frequency: args.frequency,
      windows,
    });
  }
  return resolved;
}
