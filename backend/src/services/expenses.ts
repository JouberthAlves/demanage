import type { Prisma } from '@/generated/prisma/client';
import { badRequest, conflict, notFound } from '@/http/errors';
import { todayInSaoPaulo } from '@/lib/card-billing';
import { dateKey } from '@/lib/decimal';
import {
  denormalizedCardId,
  expenseSplitInclude,
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

type ExpenseWithRelations = Prisma.ExpenseGetPayload<{
  include: { splits: true; payments: true };
}>;

function roundCents(value: number) {
  return Math.round(value * 100) / 100;
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
) {
  return withUserWriteLockTransaction(userId, async (tx) => {
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
    });

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
}): Promise<ResolvedSplit[] | null> {
  const { userId, id, tx, existing, input, nextAmount, nextFrequency } = args;
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
  });
}

export async function archiveExpense(userId: string, id: string) {
  await withUserWriteLockTransaction(userId, async (tx) => {
    const existing = await tx.expense.findFirst({
      where: { id, userId, archivedAt: null },
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
