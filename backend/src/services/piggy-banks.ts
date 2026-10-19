import {
  badRequest,
  conflict,
  notFound,
  serviceUnavailable,
} from '@/http/errors';
import { parseAmount, parseRequiredText } from '@/http/parsers';
import { parseBoolean, parseOptionalNote } from '@/http/request';
import { dayKeyOfDate } from '@/lib/civil-date';
import { PiggyError } from '@/lib/errors';
import {
  balanceFromTransactions,
  computeMonthlyGoal,
  depositToPiggyBank,
  parseAutoDebitDay,
  parseOptionalTargetDate,
  piggyGoalAmount,
  withdrawFromPiggyBank,
} from '@/lib/piggy';
import {
  interestAccruedThroughOnActivation,
  nextAutoDebitEnabledAt,
} from '@/lib/piggy/activation';
import { catchUpPiggyInterest } from '@/lib/piggy-interest';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';
import { parsePositiveAmount } from '@/lib/validate';

const NOT_FOUND_MESSAGE = 'Cofre não encontrado';
const GOAL_MESSAGE = 'Meta final deve ser maior que zero';
const TARGET_DATE_MESSAGE = 'Data de conclusão inválida';
const AUTO_DEBIT_VALUE_MESSAGE = 'Informe o valor do débito automático';
const AUTO_DEBIT_DAY_MESSAGE = 'Dia do débito automático deve ser entre 1 e 31';
const CDI_MESSAGE = '% do CDI deve estar entre 0 e 1000';
const STALE_INTEREST_MESSAGE =
  'Não foi possível fechar o rendimento anterior; alteração não aplicada';

// ---------------------------------------------------------------- helpers

function parseTargetDate(value: unknown) {
  try {
    return parseOptionalTargetDate(value);
  } catch (error) {
    if (error instanceof PiggyError) throw badRequest(TARGET_DATE_MESSAGE);
    throw error;
  }
}

/**
 * Fecha rendimentos/débitos pendentes antes de uma operação que depende do
 * saldo. Se o fechamento não puder ser concluído, a operação não é aplicada.
 */
export async function withFreshInterest<T>(
  userId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const catchUp = await catchUpPiggyInterest(userId);
  if (catchUp.stale) throw serviceUnavailable(STALE_INTEREST_MESSAGE);
  return operation();
}

// ---------------------------------------------------------------- parsing

export function parseCdiPercent(value: unknown): number {
  if (value == null || value === '') return 0;
  const parsed = Number(value);
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > 1000
  ) {
    throw badRequest(CDI_MESSAGE);
  }
  return Math.round(parsed * 10_000) / 10_000;
}

function parseGoal(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = parsePositiveAmount(value);
  if (parsed == null) throw badRequest(GOAL_MESSAGE);
  return parsed;
}

export type CreatePiggyInput = {
  name: string;
  goalAmount: number | null;
  targetDate: Date | null;
  autoDebit: boolean;
  monthlyGoal: unknown;
  autoDebitDay: unknown;
  isEmergency: boolean;
  yieldEnabled: boolean;
  cdiPercent: number;
};

export function parseCreatePiggy(
  body: Record<string, unknown>,
): CreatePiggyInput {
  return {
    name: parseRequiredText(body.name, 50, 'Campos obrigatórios: name'),
    goalAmount: parseGoal(body.goalAmount),
    targetDate: parseTargetDate(body.targetDate),
    autoDebit: parseBoolean(body.autoDebit, 'autoDebit') ?? false,
    monthlyGoal: body.monthlyGoal,
    autoDebitDay: body.autoDebitDay,
    isEmergency: parseBoolean(body.isEmergency, 'isEmergency') ?? false,
    yieldEnabled: parseBoolean(body.yieldEnabled, 'yieldEnabled') ?? false,
    cdiPercent: parseCdiPercent(body.cdiPercent),
  };
}

export type UpdatePiggyInput = {
  name?: string;
  goalAmount?: number | null;
  targetDate?: Date | null;
  monthlyGoal?: unknown;
  autoDebit?: boolean;
  autoDebitDay?: unknown;
  isEmergency?: boolean;
  yieldEnabled?: boolean;
  cdiPercent?: number;
};

export function parseUpdatePiggy(
  body: Record<string, unknown>,
): UpdatePiggyInput {
  return {
    name:
      body.name === undefined
        ? undefined
        : parseRequiredText(body.name, 50, 'Nome inválido'),
    goalAmount:
      body.goalAmount === undefined ? undefined : parseGoal(body.goalAmount),
    targetDate:
      body.targetDate === undefined
        ? undefined
        : parseTargetDate(body.targetDate),
    monthlyGoal: body.monthlyGoal,
    autoDebit: parseBoolean(body.autoDebit, 'autoDebit'),
    autoDebitDay: body.autoDebitDay,
    isEmergency: parseBoolean(body.isEmergency, 'isEmergency'),
    yieldEnabled: parseBoolean(body.yieldEnabled, 'yieldEnabled'),
    cdiPercent:
      body.cdiPercent === undefined
        ? undefined
        : parseCdiPercent(body.cdiPercent),
  };
}

export function parseMoneyMovement(body: Record<string, unknown>) {
  return {
    amount: parseAmount(body.amount, {
      message: 'Valor deve ser maior que zero',
    }),
    note: parseOptionalNote(body.note),
    // Omit this field for withdrawals; legacy deposits keep their old behavior.
    ...(body.deductFromBalance === undefined
      ? {}
      : { deductFromBalance: parseBoolean(body.deductFromBalance, 'deductFromBalance') }),
  };
}

export function parseWithdrawMovement(body: Record<string, unknown>) {
  if (body.deductFromBalance !== undefined) {
    throw badRequest('Use creditToBalance para saque ou correção de saldo');
  }
  if (body.creditToBalance === null) {
    throw badRequest('Confirme se o saque deve ser creditado no saldo');
  }
  if (body.correctionOrigin !== undefined &&
      body.correctionOrigin !== 'debited' &&
      body.correctionOrigin !== 'not_debited') {
    throw badRequest('Origem da correção inválida; informe debited ou not_debited');
  }
  const creditToBalance = parseBoolean(body.creditToBalance, 'creditToBalance') ?? true;
  if ((creditToBalance === false) !== (body.correctionOrigin !== undefined)) {
    throw badRequest('Correção requer creditToBalance:false e correctionOrigin explícito');
  }
  const { amount, note } = parseMoneyMovement(body);
  return {
    amount,
    note,
    creditToBalance,
    correctionOrigin: body.correctionOrigin as 'debited' | 'not_debited' | undefined,
  };
}

// -------------------------------------------------------------- operations

export function listPiggyBanks(userId: string, includeArchived: boolean) {
  return prisma.piggyBank.findMany({
    where: { userId, ...(includeArchived ? {} : { archivedAt: null }) },
    include: { transactions: true },
    orderBy: { createdAt: 'desc' },
  });
}

/** Only linked movements actually change the cash balance; no-double-counting. */
export async function listPiggyCashMovements(userId: string) {
  const transactions = await prisma.piggyTransaction.findMany({
    where: {
      userId,
      OR: [
        { type: 'deposit', expenseId: { not: null } },
        { type: 'withdraw', entryId: { not: null } },
      ],
    },
    select: { type: true, amount: true, date: true },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  return transactions.map((transaction) => ({
    type: transaction.type,
    amount: Number(transaction.amount),
    date: dayKeyOfDate(transaction.date),
  }));
}

export async function listPiggyTransactions(userId: string, id: string) {
  const bank = await prisma.piggyBank.findFirst({ where: { id, userId } });
  if (!bank) throw notFound(NOT_FOUND_MESSAGE);

  return prisma.piggyTransaction.findMany({
    where: { piggyBankId: id, userId },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
}

/** Valor mensal efetivo: meta/prazo quando existem, senão o informado. */
function resolveMonthlyGoal(args: {
  goalAmount: number | null;
  targetDate: Date | null;
  autoDebit: boolean;
  fallback: unknown;
}) {
  const computed = computeMonthlyGoal(args.goalAmount, args.targetDate);
  if (!args.autoDebit || computed > 0) return computed;

  const parsed = parsePositiveAmount(args.fallback);
  if (parsed == null) throw badRequest(AUTO_DEBIT_VALUE_MESSAGE);
  return parsed;
}

export function createPiggyBank(userId: string, input: CreatePiggyInput) {
  const monthlyGoal = resolveMonthlyGoal({
    goalAmount: input.goalAmount,
    targetDate: input.targetDate,
    autoDebit: input.autoDebit,
    fallback: input.monthlyGoal,
  });

  let autoDebitDay = 1;
  if (input.autoDebit) {
    const day = parseAutoDebitDay(input.autoDebitDay ?? 1);
    if (day == null) throw badRequest(AUTO_DEBIT_DAY_MESSAGE);
    autoDebitDay = day;
  }

  return prisma.piggyBank.create({
    data: {
      userId,
      name: input.name,
      goalAmount: input.goalAmount,
      targetDate: input.targetDate,
      monthlyGoal,
      autoDebit: input.autoDebit,
      autoDebitDay,
      autoDebitEnabledAt: input.autoDebit ? new Date() : null,
      isEmergency: input.isEmergency,
      yieldEnabled: input.yieldEnabled,
      cdiPercent: input.yieldEnabled ? input.cdiPercent : 0,
    },
    include: { transactions: true },
  });
}

export async function updatePiggyBank(
  userId: string,
  id: string,
  input: UpdatePiggyInput,
) {
  const apply = () =>
    withUserWriteLockTransaction(userId, async (tx) => {
      const existing = await tx.piggyBank.findFirst({
        where: { id, userId },
        include: { transactions: true },
      });
      if (!existing) throw notFound(NOT_FOUND_MESSAGE);
      if (existing.archivedAt) {
        throw badRequest('Cofre arquivado não pode ser editado');
      }

      const goalAmount =
        input.goalAmount !== undefined
          ? input.goalAmount
          : piggyGoalAmount(existing.goalAmount);
      const targetDate =
        input.targetDate !== undefined ? input.targetDate : existing.targetDate;
      const autoDebit = input.autoDebit ?? existing.autoDebit;

      const monthlyGoal = resolveMonthlyGoal({
        goalAmount,
        targetDate,
        autoDebit,
        // `monthlyGoal` persistido é Prisma.Decimal: converter para string.
        fallback:
          input.monthlyGoal !== undefined
            ? input.monthlyGoal
            : existing.monthlyGoal.toString(),
      });

      let autoDebitDay = existing.autoDebitDay;
      if (
        input.autoDebitDay !== undefined ||
        (input.autoDebit !== undefined && autoDebit)
      ) {
        const day = parseAutoDebitDay(
          input.autoDebitDay !== undefined
            ? input.autoDebitDay
            : existing.autoDebitDay,
        );
        if (autoDebit && day == null) throw badRequest(AUTO_DEBIT_DAY_MESSAGE);
        if (day != null) autoDebitDay = day;
      }

      const yieldEnabled = input.yieldEnabled ?? existing.yieldEnabled;
      const cdiPercent = yieldEnabled
        ? (input.cdiPercent ?? Number(existing.cdiPercent))
        : 0;

      // Auto-debit: remember WHEN it was switched on so months before it are
      // never back-filled. Re-enabling resets it; disabling clears it.
      const autoDebitEnabledAt = nextAutoDebitEnabledAt(existing, autoDebit);

      // Yield: accrual must begin the day it becomes effective. Without this a
      // null/old interestAccruedThrough would credit retroactive interest.
      // (withFreshInterest already settled the OLD settings before this runs.)
      const wasYielding =
        existing.yieldEnabled && existing.cdiPercent.greaterThan(0);
      const willYield = yieldEnabled && cdiPercent > 0;
      const activatedThrough = interestAccruedThroughOnActivation(
        wasYielding,
        willYield,
      );
      const accrualReset = activatedThrough
        ? { interestAccruedThrough: activatedThrough }
        : {};

      return tx.piggyBank.update({
        where: { id },
        data: {
          ...accrualReset,
          autoDebitEnabledAt,
          ...(input.name !== undefined ? { name: input.name } : {}),
          goalAmount,
          targetDate,
          monthlyGoal,
          autoDebit,
          autoDebitDay,
          yieldEnabled,
          cdiPercent,
          ...(input.isEmergency !== undefined
            ? { isEmergency: input.isEmergency }
            : {}),
        },
        include: { transactions: true },
      });
    });

  const touchesYield =
    input.yieldEnabled !== undefined || input.cdiPercent !== undefined;
  return touchesYield ? withFreshInterest(userId, apply) : apply();
}

export function archivePiggyBank(userId: string, id: string) {
  return withUserWriteLockTransaction(userId, async (tx) => {
    const bank = await tx.piggyBank.findFirst({
      where: { id, userId },
      include: { transactions: true },
    });
    if (!bank) throw notFound(NOT_FOUND_MESSAGE);
    if (bank.archivedAt) throw badRequest('Cofre já arquivado');

    const balance = balanceFromTransactions(bank.transactions);
    const goalAmount = piggyGoalAmount(bank.goalAmount);
    const goalReached =
      goalAmount == null || Boolean(bank.completedAt) || balance >= goalAmount;
    if (!goalReached) {
      throw badRequest('Arquivar só é permitido após atingir a meta');
    }

    return tx.piggyBank.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: { transactions: true },
    });
  });
}

export async function deletePiggyBank(userId: string, id: string) {
  await withUserWriteLockTransaction(userId, async (tx) => {
    const existing = await tx.piggyBank.findFirst({
      where: { id, userId },
      include: { transactions: { select: { id: true } } },
    });
    if (!existing) throw notFound(NOT_FOUND_MESSAGE);
    if (existing.transactions.length > 0) {
      throw conflict(
        'Cofres com movimentações devem ser arquivados para preservar o histórico',
      );
    }
    await tx.piggyBank.delete({ where: { id } });
  });
}

export function depositToBank(
  userId: string,
  id: string,
  movement: { amount: number; note: string | null; deductFromBalance?: boolean },
) {
  return withFreshInterest(userId, () =>
    depositToPiggyBank({
      userId,
      piggyBankId: id,
      amount: movement.amount,
      source: 'manual',
      note: movement.note,
      deductFromBalance: movement.deductFromBalance ?? true,
    }),
  );
}

export function withdrawFromBank(
  userId: string,
  id: string,
  movement: {
    amount: number;
    note: string | null;
    creditToBalance?: boolean;
    correctionOrigin?: 'debited' | 'not_debited';
  },
) {
  if ((movement.creditToBalance === false) !== (movement.correctionOrigin !== undefined)) {
    throw badRequest('Correção requer creditToBalance:false e correctionOrigin explícito');
  }
  const operation = () =>
    withdrawFromPiggyBank({
      userId,
      piggyBankId: id,
      amount: movement.amount,
      note: movement.note,
      creditToBalance: movement.creditToBalance ?? true,
      correctionOrigin: movement.correctionOrigin,
    });
  // A correction must not trigger CDI accrual or auto-debit before provenance
  // verification rejects it; the target bank itself is checked under user lock.
  if (movement.correctionOrigin) {
    return operation().catch((error: unknown) => {
      if (error instanceof PiggyError && error.code === 'CORRECTION_YIELD_BLOCKED') {
        throw conflict('Correção indisponível para cofrinho com CDI ativo ou rendimento histórico');
      }
      if (error instanceof PiggyError && error.code === 'CORRECTION_ORIGIN_AMBIGUOUS') {
        throw conflict('Origem do saldo ambígua: há saques anteriores, depósitos automáticos ou correções não identificadas');
      }
      if (error instanceof PiggyError && error.code === 'CORRECTION_ORIGIN_INSUFFICIENT') {
        throw conflict('Origem informada não tem depósito suficiente para esta correção');
      }
      throw error;
    });
  }
  return withFreshInterest(userId, operation);
}

export function processAutoDebit(userId: string) {
  return catchUpPiggyInterest(userId);
}
