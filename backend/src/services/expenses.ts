import type { Prisma } from '@/generated/prisma/client';
import { badRequest, conflict, notFound } from '@/http/errors';
import { cardsWithUnclosedBilling } from '@/lib/billing/guard';
import {
  legacyBaselineMonth,
  obligationSplitSnapshot,
  parseObligationVersions,
  scheduleMovesEarlier,
} from '@/lib/billing/obligation-versions';
import { hasRetroactiveClosedCardCharge } from '@/lib/billing/retroactive-recurring';
import { todayInSaoPaulo } from '@/lib/card-billing';
import { todayKeyInSaoPaulo } from '@/lib/civil-date';
import { dateKey } from '@/lib/decimal';
import {
  assertProspectiveVersionedCardLimits,
  denormalizedCardId,
  ExpenseSplitError,
  expenseSplitInclude,
  getCommittedByCard,
  replaceExpenseSplits,
  resolveAndValidateSplits,
  type ResolvedSplit,
} from '@/lib/expense-splits';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

import { customTagSelect, resolveCustomTagId } from './custom-tags';
import type { CreateExpenseInput, UpdateExpenseInput } from './expense-input';
import { monthBounds } from './months';
import { resolveSchedule } from './schedule';

export { serializeExpense } from '@/lib/expense-splits';

const NOT_FOUND_MESSAGE = 'Despesa não encontrada';
const CONFLICT_MESSAGE =
  'Despesa alterada por outra operação; atualize e tente novamente';
const FUTURE_DATE_MESSAGE = 'A data da despesa avulsa não pode ser futura';
const CUSTOM_TAG_CATEGORY_MESSAGE =
  'Tipos personalizados devem usar category=outro';

export const expenseInclude = {
  customTag: { select: customTagSelect },
  ...expenseSplitInclude,
} satisfies Prisma.ExpenseInclude;

/**
 * Until obligation revisions are stored per competence, editing or removing a
 * card charge before pending closes would rewrite historical invoice amounts.
 * The billing endpoint acquires the same user lock and can settle these first.
 */
async function assertAffectedCardsCaughtUp(
  tx: Prisma.TransactionClient,
  userId: string,
  cardIds: Array<string | null | undefined>,
  now?: Date,
) {
  const ids = [...new Set(cardIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;

  const cards = await tx.card.findMany({
    where: { userId, id: { in: ids }, archivedAt: null },
  });
  if (cardsWithUnclosedBilling(cards, now).length > 0) {
    throw conflict(
      'Feche as faturas pendentes do cartão antes de editar ou excluir esta despesa; depois tente novamente',
    );
  }
}

type ExpenseWithRelations = Prisma.ExpenseGetPayload<{
  include: { splits: true; payments: true };
}>;

function roundCents(value: number) {
  return Math.round(value * 100) / 100;
}

/** One-off payments and closed card charges are historical cash facts. */
export function assertOneOffMutationSafe(args: {
  paymentCount: number;
  oldCashAmount: number;
  newCashAmount: number;
  hasCardSettlement: boolean;
}): boolean {
  if (args.paymentCount > 0 || args.oldCashAmount > 0) {
    throw conflict(
      'Despesa com pagamento registrado não pode alterar valor, frequência ou forma de pagamento',
    );
  }
  if (args.hasCardSettlement) {
    throw conflict(
      'Despesa já faturada não pode alterar valor ou forma de pagamento',
    );
  }
  // Card-only -> PIX (before closing): the newly paid cash must be recorded.
  return args.newCashAmount > 0;
}

/** A one-off cannot restart an old recurring obligation's immutable price chain. */
export function assertExpenseFrequencyTransitionSafe(
  currentFrequency: string,
  nextFrequency: string,
  hasUnprovenCardHistory = false,
) {
  if (currentFrequency === 'unica' && nextFrequency !== 'unica') {
    throw conflict(
      'Para voltar à recorrência, crie uma nova despesa; o histórico anterior não pode ser reativado',
    );
  }
  if (currentFrequency !== 'unica' && nextFrequency === 'unica' && hasUnprovenCardHistory) {
    throw conflict(
      'Histórico do cartão pode conter fatura recorrente pendente; para registrar uma despesa única, crie uma nova despesa',
    );
  }
}

/**
 * Parcela que sai do caixa na hora (PIX). Sem splits, a despesa inteira é caixa.
 */
export function cashAmountOf(
  resolvedSplits: Pick<ResolvedSplit, 'kind' | 'amount'>[],
  totalAmount: number,
) {
  if (resolvedSplits.length === 0) return totalAmount;
  return roundCents(
    resolvedSplits
      .filter((split) => split.kind === 'pix')
      .reduce((sum, split) => sum + split.amount, 0),
  );
}

/**
 * Entradas de split reconstruídas da despesa persistida (splits ou, em linhas
 * legadas, só `cardId` = 100% no cartão). Vazio = despesa sem cartão.
 */
export function existingSplitInputs(
  expense: Pick<ExpenseWithRelations, 'cardId' | 'splits'>,
) {
  if (expense.splits.length > 0) {
    return expense.splits.map((split) =>
      split.kind === 'pix'
        ? { kind: 'pix' as const, percent: Number(split.percent) }
        : {
            kind: 'card' as const,
            cardId: String(split.cardId),
            percent: Number(split.percent),
          },
    );
  }
  if (expense.cardId) {
    return [{ kind: 'card' as const, cardId: expense.cardId, percent: 100 }];
  }
  return [];
}

type FinancialSplit = Pick<
  ResolvedSplit,
  'kind' | 'cardId' | 'amount' | 'percent'
>;

function comparableSplits(
  splits: FinancialSplit[],
  legacyCardId: string | null,
  amount: number,
) {
  const effective =
    splits.length > 0
      ? splits
      : legacyCardId
        ? [
            {
              kind: 'card' as const,
              cardId: legacyCardId,
              percent: 100,
              amount,
            },
          ]
        : [{ kind: 'pix' as const, cardId: null, percent: 100, amount }];
  return effective
    .map(
      (split) =>
        `${split.kind}:${split.cardId ?? ''}:${Number(split.percent)}:${roundCents(Number(split.amount))}`,
    )
    .sort()
    .join('|');
}

function cashOfPersistedExpense(expense: ExpenseWithRelations) {
  if (expense.splits.length > 0) {
    return cashAmountOf(
      expense.splits.map((split) => ({
        kind: split.kind,
        amount: Number(split.amount),
      })),
      Number(expense.amount),
    );
  }
  return expense.cardId ? 0 : Number(expense.amount);
}

function assertUniqueDateNotFuture(date: Date | null | undefined) {
  if (date && date > todayInSaoPaulo()) throw badRequest(FUTURE_DATE_MESSAGE);
}

export function listExpenses(userId: string) {
  return prisma.expense.findMany({
    where: { userId, archivedAt: null, systemOrigin: 'manual' },
    include: expenseInclude,
    orderBy: { createdAt: 'desc' },
  });
}

export async function createExpense(userId: string, input: CreateExpenseInput) {
  const schedule = resolveSchedule({
    kind: 'expense',
    frequency: input.frequency,
    body: input.schedule,
  });
  const uniqueDate = schedule.date ?? null;
  assertUniqueDateNotFuture(uniqueDate);

  return withUserWriteLockTransaction(userId, async (tx) => {
    const customTagId = await resolveCustomTagId(tx, {
      userId,
      scope: 'expense',
      customTagId: input.customTagId,
    });
    if (customTagId && input.category !== 'outro') {
      throw badRequest(CUSTOM_TAG_CATEGORY_MESSAGE);
    }

    const resolvedSplits = await resolveAndValidateSplits({
      userId,
      totalAmount: input.amount,
      splits: input.splits,
      cardId: input.cardId,
      frequency: input.frequency,
      tx,
    });

    // A retroactive recurring card charge after a closed cycle would never be
    // billed by the incremental planner. Reject atomically instead of silently
    // dropping the historical competence or mutating an immutable invoice.
    if (input.frequency !== 'unica') {
      const recurringFrequency = input.frequency;
      const cardIds = [...new Set(resolvedSplits
        .filter((split) => split.kind === 'card' && split.cardId)
        .map((split) => split.cardId!))];
      if (cardIds.length) {
        const cards = await tx.card.findMany({
          where: { userId, id: { in: cardIds }, archivedAt: null },
          select: { createdAt: true, lastInvoicedOn: true },
        });
        if (cards.some((card) => hasRetroactiveClosedCardCharge(card, {
          frequency: recurringFrequency,
          amount: input.amount,
          startsAt: schedule.startsAt ?? null,
          endsAt: schedule.endsAt ?? null,
          dueDay: schedule.day ?? null,
        }))) {
          throw conflict('Recorrência retroativa inclui competência já faturada; use um ajuste auditável, não altere fatura fechada');
        }
      }
    }
    const created = await tx.expense.create({
      data: {
        userId,
        name: input.name,
        amount: input.amount,
        category: input.category,
        frequency: input.frequency,
        occurredAt: uniqueDate,
        cardId: denormalizedCardId(resolvedSplits),
        dueDay: schedule.day ?? null,
        startsAt: schedule.startsAt ?? null,
        endsAt: schedule.endsAt ?? null,
        notes: input.notes,
        customTagId,
      },
    });

    await replaceExpenseSplits({
      tx,
      expenseId: created.id,
      resolved: resolvedSplits,
    });

    if (created.frequency !== 'unica') {
      const initialMonth = (created.startsAt ?? created.createdAt).toISOString().slice(0, 7);
      await tx.expenseObligationVersion.create({
        data: {
          expenseId: created.id,
          sequence: 1,
          effectiveMonth: initialMonth,
          amount: created.amount,
          cardId: created.cardId,
          splits: obligationSplitSnapshot(resolvedSplits),
        },
      });
    }

    if (uniqueDate) {
      const cashAmount = cashAmountOf(resolvedSplits, input.amount);
      if (cashAmount > 0) {
        await tx.expensePayment.create({
          data: {
            expenseId: created.id,
            month: uniqueDate.toISOString().slice(0, 7),
            amount: cashAmount,
            paidAt: uniqueDate,
          },
        });
      }
    }

    return tx.expense.findUniqueOrThrow({
      where: { id: created.id },
      include: expenseInclude,
    });
  });
}

export async function updateExpense(
  userId: string,
  id: string,
  input: UpdateExpenseInput,
  now?: Date,
) {
  return withUserWriteLockTransaction(userId, async (tx) => {
    const editNow = now ?? new Date();
    const effectiveMonth = todayKeyInSaoPaulo(editNow).slice(0, 7);
    const existing = await tx.expense.findFirst({
      where: { id, userId },
      include: { splits: true, payments: true },
    });
    if (!existing || existing.archivedAt) throw notFound(NOT_FOUND_MESSAGE);
    if (existing.systemOrigin !== 'manual') {
      throw badRequest(
        'Movimentações de cofrinho ou ativos não podem ser editadas aqui',
      );
    }
    if (existing.isInvoice) {
      throw badRequest(
        'Faturas preservam o valor calculado do ciclo e não podem ser editadas',
      );
    }

    assertCategoryChangeAllowed(existing.category, input.category);

    const resolvedTagId =
      input.customTagId === undefined
        ? undefined
        : await resolveCustomTagId(tx, {
            userId,
            scope: 'expense',
            customTagId: input.customTagId,
          });

    const nextCategory = input.category ?? existing.category;
    const nextFrequency = input.frequency ?? existing.frequency;
    assertExpenseFrequencyTransitionSafe(existing.frequency, nextFrequency);
    const nextAmount = input.amount ?? Number(existing.amount);
    const nextCustomTagId =
      resolvedTagId !== undefined ? resolvedTagId : existing.customTagId;
    if (nextCustomTagId && nextCategory !== 'outro') {
      throw badRequest(CUSTOM_TAG_CATEGORY_MESSAGE);
    }

    const schedule = resolveSchedule({
      kind: 'expense',
      frequency: nextFrequency,
      body: input.schedule,
      existing: {
        day: existing.dueDay,
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        date: existing.occurredAt,
      },
    });

    const nextOccurredAt =
      nextFrequency === 'unica' ? (schedule.date ?? existing.occurredAt) : null;
    if (
      existing.frequency === 'unica' &&
      existing.payments.length > 0 &&
      input.schedule.date !== undefined &&
      nextFrequency === 'unica' &&
      (!nextOccurredAt ||
        !existing.occurredAt ||
        dateKey(nextOccurredAt) !== dateKey(existing.occurredAt))
    ) {
      throw badRequest(
        'A data de uma despesa já registrada não pode ser alterada',
      );
    }
    assertUniqueDateNotFuture(nextOccurredAt);

    const nextSplits = await resolveNextSplits({
      userId,
      id,
      tx,
      existing,
      input,
      nextAmount,
      nextFrequency,
      asOf: editNow,
    });

    const oldSplits = existing.splits.map((split) => ({
      kind: split.kind,
      cardId: split.cardId,
      amount: Number(split.amount),
      percent: Number(split.percent),
    }));
    const oldAmount = Number(existing.amount);
    const revisedSplits = nextSplits ?? oldSplits;
    const financialChange = nextAmount !== oldAmount ||
      (nextSplits !== null && comparableSplits(revisedSplits, existing.cardId, nextAmount) !==
        comparableSplits(oldSplits, existing.cardId, oldAmount));
    const recurringVersionChange = financialChange &&
      existing.frequency !== 'unica' && nextFrequency !== 'unica';
    const oldScheduleChanged = existing.frequency !== 'unica' && (
      nextFrequency !== existing.frequency ||
      (schedule.day !== undefined && schedule.day !== existing.dueDay) ||
      (schedule.startsAt !== undefined &&
        (schedule.startsAt ? dateKey(schedule.startsAt) : null) !==
        (existing.startsAt ? dateKey(existing.startsAt) : null)) ||
      (schedule.endsAt !== undefined &&
        (schedule.endsAt ? dateKey(schedule.endsAt) : null) !==
        (existing.endsAt ? dateKey(existing.endsAt) : null))
    );
    if (existing.frequency !== 'unica' && nextFrequency !== 'unica' &&
      scheduleMovesEarlier(existing.startsAt, schedule.startsAt)) {
      throw conflict('Não é possível antecipar o início de uma despesa recorrente; crie um ajuste auditável para competências anteriores');
    }
    if (oldScheduleChanged && existing.payments.length) {
      throw conflict('Despesa com pagamento registrado não pode alterar recorrência ou agenda');
    }
    const oldVersions = recurringVersionChange || oldScheduleChanged
      ? await tx.expenseObligationVersion.findMany({
          where: { expenseId: id },
          orderBy: { sequence: 'asc' },
        })
      : [];
    if (existing.frequency !== 'unica' && nextFrequency === 'unica') {
      // A frequency change would make chargeAmountDecimal ignore ALL previous
      // recurring obligation versions, even if an earlier version belonged to
      // a card that is no longer in the current split. Until a fully audited
      // stop-and-settle operation exists, reject any unproven card history.
      const historical = parseObligationVersions(oldVersions);
      const hasCardHistory =
        oldVersions.length === 0 || // Legacy history without snapshots is unknown.
        Boolean(existing.cardId) ||
        existing.splits.some((split) => split.kind === 'card') ||
        historical.some((version) =>
          Boolean(version.cardId) || version.splits.some((split) => split.kind === 'card'));
      assertExpenseFrequencyTransitionSafe(existing.frequency, nextFrequency, hasCardHistory);
    }
    const priorCardIds = oldScheduleChanged
      ? parseObligationVersions(oldVersions).flatMap((version) => [
          version.cardId,
          ...version.splits.filter((split) => split.kind === 'card').map((split) => split.cardId),
        ])
      : [];
    if (recurringVersionChange && existing.payments.some((payment) => payment.month >= effectiveMonth)) {
      throw conflict('Despesa já paga nesta competência não pode alterar valor ou forma de pagamento');
    }

    const changesCardHistory =
      input.amount !== undefined ||
      input.frequency !== undefined ||
      input.cardId !== undefined ||
      input.splits !== undefined ||
      input.schedule.day !== undefined ||
      input.schedule.startsAt !== undefined ||
      input.schedule.endsAt !== undefined ||
      input.schedule.date !== undefined;
    const changesSchedule = input.frequency !== undefined ||
      input.schedule.day !== undefined || input.schedule.startsAt !== undefined ||
      input.schedule.endsAt !== undefined || input.schedule.date !== undefined;
    // Historical revisions are sufficient for financial-only changes when a
    // prior snapshot exists. Legacy rows with no snapshots, schedule changes,
    // deletion, and one-offs still require catching up pending card cycles.
    if (changesCardHistory && (!recurringVersionChange || changesSchedule || oldVersions.length === 0)) {
      await assertAffectedCardsCaughtUp(tx, userId, [
        existing.cardId,
        ...existing.splits.map((split) => split.cardId),
        ...(nextSplits ?? []).map((split) => split.cardId),
        ...priorCardIds,
      ], now);
    }

    if (recurringVersionChange) {
      const previousVersions = oldVersions.length
        ? parseObligationVersions(oldVersions)
        : [{
            sequence: 1,
            effectiveMonth: legacyBaselineMonth(existing.startsAt, existing.createdAt),
            amount: existing.amount,
            cardId: existing.cardId,
            splits: existing.splits,
          }];
      const proposedCardId = nextSplits
        ? denormalizedCardId(nextSplits)
        : existing.cardId;
      const proposedSplits = nextSplits ?? existing.splits;
      const projectedExpense = {
        ...existing,
        amount: nextAmount,
        cardId: proposedCardId,
        splits: proposedSplits,
        frequency: nextFrequency,
        dueDay: schedule.day ?? existing.dueDay,
        startsAt: schedule.startsAt ?? existing.startsAt,
        endsAt: schedule.endsAt ?? existing.endsAt,
        obligationVersions: [
          ...previousVersions,
          {
            sequence: oldVersions.length
              ? oldVersions[oldVersions.length - 1].sequence + 1
              : 2,
            effectiveMonth,
            amount: nextAmount,
            cardId: proposedCardId,
            splits: proposedSplits,
          },
        ],
      };
      const [cards, otherCommittedByCard] = await Promise.all([
        tx.card.findMany({ where: { userId, archivedAt: null } }),
        getCommittedByCard({ userId, excludeExpenseId: id, tx, asOf: editNow }),
      ]);
      try {
        assertProspectiveVersionedCardLimits({
          cards,
          otherCommittedByCard,
          prospective: projectedExpense,
          asOf: editNow,
        });
      } catch (error) {
        if (error instanceof ExpenseSplitError) throw conflict(error.message);
        throw error;
      }
    }

    let recordNewOneOffCash = false;
    if (existing.frequency === 'unica' || nextFrequency === 'unica') {
      const oldAmount = Number(existing.amount);
      const oldSplits = existing.splits.map((split) => ({
        kind: split.kind,
        cardId: split.cardId,
        percent: Number(split.percent),
        amount: Number(split.amount),
      }));
      const financialChange =
        nextAmount !== oldAmount ||
        nextFrequency !== existing.frequency ||
        (nextOccurredAt ? dateKey(nextOccurredAt) : null) !==
          (existing.occurredAt ? dateKey(existing.occurredAt) : null) ||
        (nextSplits !== null &&
          comparableSplits(nextSplits, null, nextAmount) !==
            comparableSplits(oldSplits, existing.cardId, oldAmount));

      if (financialChange) {
        const affectedCardIds = [
          ...new Set(
            [
              existing.cardId,
              ...existing.splits.map((split) => split.cardId),
              ...(nextSplits ?? []).map((split) => split.cardId),
            ].filter((cardId): cardId is string => !!cardId),
          ),
        ];
        const cards = affectedCardIds.length
          ? await tx.card.findMany({
              where: { userId, id: { in: affectedCardIds } },
              select: { lastInvoicedOn: true, lastBillingProcessedAt: true },
            })
          : [];
        const earliestAffectedCharge =
          existing.frequency === 'unica'
            ? (existing.occurredAt ?? existing.createdAt)
            : (existing.startsAt ?? existing.createdAt);
        const nextRecurringStart =
          nextFrequency === 'unica'
            ? null
            : (schedule.startsAt ?? existing.startsAt ?? existing.createdAt);
        const hasCardSettlement = cards.some(
          (card) =>
            card.lastInvoicedOn &&
            ((existing.frequency !== 'unica' &&
              dateKey(card.lastInvoicedOn) >=
                dateKey(earliestAffectedCharge)) ||
              (nextRecurringStart != null &&
                dateKey(card.lastInvoicedOn) >= dateKey(nextRecurringStart)) ||
              ((card.lastBillingProcessedAt == null ||
                card.lastBillingProcessedAt >= existing.createdAt) &&
                (dateKey(card.lastInvoicedOn) >=
                  dateKey(earliestAffectedCharge) ||
                  (nextOccurredAt != null &&
                    dateKey(card.lastInvoicedOn) >= dateKey(nextOccurredAt))))),
        );
        const oldCashAmount = cashOfPersistedExpense(existing);
        const newCashAmount = nextSplits
          ? cashAmountOf(nextSplits, nextAmount)
          : existing.cardId && existing.splits.length === 0
            ? 0
            : existing.splits.length > 0
              ? oldCashAmount
              : nextAmount;
        recordNewOneOffCash = assertOneOffMutationSafe({
          paymentCount: existing.payments.length,
          oldCashAmount: existing.frequency === 'unica' ? oldCashAmount : 0,
          newCashAmount,
          hasCardSettlement,
        });
      }
    }

    // updatedAt como guarda otimista contra escritores fora do lock do usuário.
    const { count } = await tx.expense.updateMany({
      where: { id, userId, updatedAt: existing.updatedAt },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.frequency !== undefined
          ? { frequency: input.frequency }
          : {}),
        occurredAt: nextOccurredAt,
        // cardId só muda quando splits/cardId foram enviados ou recalculados.
        ...(nextSplits ? { cardId: denormalizedCardId(nextSplits) } : {}),
        ...(schedule.day !== undefined ? { dueDay: schedule.day } : {}),
        ...(schedule.startsAt !== undefined
          ? { startsAt: schedule.startsAt }
          : {}),
        ...(schedule.endsAt !== undefined ? { endsAt: schedule.endsAt } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(resolvedTagId !== undefined ? { customTagId: resolvedTagId } : {}),
      },
    });
    if (count === 0) throw conflict(CONFLICT_MESSAGE);

    if (nextSplits) {
      await replaceExpenseSplits({ tx, expenseId: id, resolved: nextSplits });
    }

    if (recurringVersionChange) {
      // Seed a legacy baseline only after any older card invoices were closed;
      // the migration itself cannot reconstruct already overwritten values.
      if (!oldVersions.length) {
        await tx.expenseObligationVersion.create({
          data: {
            expenseId: id,
            sequence: 1,
            effectiveMonth: legacyBaselineMonth(existing.startsAt, existing.createdAt),
            amount: existing.amount,
            cardId: existing.cardId,
            splits: obligationSplitSnapshot(existing.splits),
          },
        });
      }
      await tx.expenseObligationVersion.create({
        data: {
          expenseId: id,
          sequence: oldVersions.length ? oldVersions[oldVersions.length - 1].sequence + 1 : 2,
          effectiveMonth,
          amount: nextAmount,
          cardId: nextSplits ? denormalizedCardId(nextSplits) : existing.cardId,
          splits: obligationSplitSnapshot(revisedSplits),
        },
      });
    }

    if (
      recordNewOneOffCash &&
      existing.frequency === 'unica' &&
      nextOccurredAt
    ) {
      await tx.expensePayment.create({
        data: {
          expenseId: id,
          month: nextOccurredAt.toISOString().slice(0, 7),
          amount: cashAmountOf(nextSplits ?? [], nextAmount),
          paidAt: nextOccurredAt,
        },
      });
    }

    if (
      existing.frequency !== 'unica' &&
      nextFrequency === 'unica' &&
      nextOccurredAt
    ) {
      const month = nextOccurredAt.toISOString().slice(0, 7);
      const cashAmount = cashAmountOf(nextSplits ?? [], nextAmount);
      if (
        cashAmount > 0 &&
        !existing.payments.some((payment) => payment.month === month)
      ) {
        await tx.expensePayment.create({
          data: {
            expenseId: id,
            month,
            amount: cashAmount,
            paidAt: nextOccurredAt,
          },
        });
      }
    }

    return tx.expense.findUniqueOrThrow({
      where: { id },
      include: expenseInclude,
    });
  });
}

function assertCategoryChangeAllowed(
  current: string,
  next: string | undefined,
) {
  if (next !== 'cofrinho' && current !== 'cofrinho') return;
  if (next !== undefined && next !== 'cofrinho') {
    throw badRequest('Despesas de cofrinho não podem mudar de categoria');
  }
  if (next === 'cofrinho' && current !== 'cofrinho') {
    throw badRequest('Depósitos no cofrinho são feitos pela aba Cofrinho');
  }
}

/**
 * Splits resultantes do PATCH, ou `null` para "não mexer em splits nem cardId".
 *
 * - `splits`/`cardId` no corpo: substitui (e valida cartões e limites).
 * - Sem eles, só recalcula quando algo que afeta o compromisso do cartão muda
 *   (valor, frequência, início/fim) — usando os splits atuais, ou o `cardId`
 *   legado como 100% no cartão. Um simples rename nunca toca no cartão.
 */
async function resolveNextSplits(args: {
  userId: string;
  id: string;
  tx: Prisma.TransactionClient;
  existing: ExpenseWithRelations;
  input: UpdateExpenseInput;
  nextAmount: number;
  nextFrequency: string;
  asOf: Date;
}): Promise<ResolvedSplit[] | null> {
  const { userId, id, tx, existing, input, nextAmount, nextFrequency, asOf } = args;
  const splitsProvided =
    input.splits !== undefined || input.cardId !== undefined;

  if (splitsProvided) {
    return resolveAndValidateSplits({
      userId,
      totalAmount: nextAmount,
      splits: input.splits,
      cardId: input.cardId,
      frequency: nextFrequency,
      excludeExpenseId: id,
      tx,
      asOf,
    });
  }

  const affectsCardCommitment =
    input.amount !== undefined ||
    input.frequency !== undefined ||
    input.schedule.startsAt !== undefined ||
    input.schedule.endsAt !== undefined;
  const inputs = existingSplitInputs(existing);
  if (!affectsCardCommitment || inputs.length === 0) return null;

  return resolveAndValidateSplits({
    userId,
    totalAmount: nextAmount,
    splits: inputs,
    cardId: undefined,
    frequency: nextFrequency,
    excludeExpenseId: id,
    tx,
    asOf,
  });
}

export async function archiveExpense(userId: string, id: string) {
  await withUserWriteLockTransaction(userId, async (tx) => {
    const existing = await tx.expense.findFirst({
      where: { id, userId, archivedAt: null },
      include: { splits: true, obligationVersions: true },
    });
    if (!existing) throw notFound(NOT_FOUND_MESSAGE);
    if (existing.systemOrigin !== 'manual') {
      throw badRequest(
        'Movimentações de cofrinho ou ativos não podem ser excluídas aqui',
      );
    }
    if (existing.isInvoice) {
      throw badRequest(
        'Faturas preservam o histórico do ciclo e não podem ser excluídas',
      );
    }

    await assertAffectedCardsCaughtUp(tx, userId, [
      existing.cardId,
      ...existing.splits.map((split) => split.cardId),
      ...parseObligationVersions(existing.obligationVersions).flatMap((version) => [
        version.cardId,
        ...version.splits.filter((split) => split.kind === 'card').map((split) => split.cardId),
      ]),
    ]);

    await tx.expense.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  });
}

export async function payExpense(userId: string, id: string, month: string) {
  return withUserWriteLockTransaction(userId, async (tx) => {
    const existing = await tx.expense.findFirst({
      where: { id, userId, archivedAt: null, systemOrigin: 'manual' },
      include: expenseInclude,
    });
    if (!existing) throw notFound(NOT_FOUND_MESSAGE);

    if (existing.isInvoice) {
      const periodEnd = existing.billingPeriodEnd ?? existing.occurredAt;
      const invoiceMonth = periodEnd?.toISOString().slice(0, 7);
      if (!invoiceMonth || month !== invoiceMonth) {
        throw badRequest(
          'O mês de pagamento deve corresponder ao ciclo da fatura',
        );
      }
    } else if (existing.frequency !== 'mensal') {
      throw badRequest(
        'Pagamento antecipado é permitido apenas para despesas fixas mensais',
      );
    }

    const cashAmount = existing.isInvoice
      ? Number(existing.amount)
      : existing.splits.length > 0
        ? cashAmountOf(
            existing.splits.map((split) => ({
              kind: split.kind,
              amount: Number(split.amount),
            })),
            Number(existing.amount),
          )
        : existing.cardId
          ? 0
          : Number(existing.amount);

    if (!Number.isFinite(cashAmount) || cashAmount <= 0) {
      throw badRequest(
        existing.isInvoice
          ? 'Valor da fatura inválido'
          : 'Despesas somente no cartão entram no saldo pela fatura',
      );
    }

    if (!existing.isInvoice) {
      const bounds = monthBounds(month);
      if (existing.startsAt && existing.startsAt > bounds.end) {
        throw badRequest('Essa despesa ainda não começou no mês selecionado');
      }
      if (existing.endsAt && existing.endsAt < bounds.start) {
        throw badRequest('Essa despesa já terminou antes do mês selecionado');
      }
    }

    const payment = await tx.expensePayment.upsert({
      where: { expenseId_month: { expenseId: id, month } },
      update: {},
      create: {
        expenseId: id,
        month,
        amount: cashAmount,
        paidAt:
          existing.paidForMonth === month && existing.paidAt
            ? existing.paidAt
            : new Date(),
      },
    });

    if (existing.paidForMonth !== month) {
      await tx.expense.update({
        where: { id },
        data: { paidForMonth: month, paidAt: payment.paidAt },
      });
    }

    return tx.expense.findFirstOrThrow({
      where: { id, userId },
      include: expenseInclude,
    });
  });
}
