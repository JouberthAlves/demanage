import { createHash, timingSafeEqual } from 'node:crypto';

import { Prisma } from '@/generated/prisma/client';
import { badRequest, conflict, notFound } from '@/http/errors';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

import {
  type FinanceAction,
  type FinanceActionResult,
  runFinanceOperationInTransaction,
} from './finance-operation';
import { withFreshInterest } from './piggy-banks';

export type CommitFinanceOperationInput = {
  userId: string;
  clientId: string;
  idempotencyKey: string;
  intentNonce: string;
  payloadDigest: string;
  action: FinanceAction;
};

type CommittedOperationStatus = {
  status: 'committed' | 'undone';
  result: FinanceActionResult;
  committedAt: Date;
  undoneAt: Date | null;
};

const ACTION_FIELDS: Record<FinanceAction['kind'], readonly string[]> = {
  receive_income: ['amountCents', 'dateKey', 'description', 'kind', 'tagName'],
  receive_and_save: ['amountCents', 'bankId', 'dateKey', 'description', 'kind', 'tagName'],
  deposit_existing_cash: ['amountCents', 'bankId', 'dateKey', 'deductFromBalance', 'kind', 'note'],
};

/** Stable signed-content digest: every field is included, in sorted order. */
export function digestFinanceAction(action: FinanceAction): string {
  if (!action || typeof action !== 'object' || !Object.hasOwn(ACTION_FIELDS, action.kind)) {
    throw badRequest('Ação financeira inválida');
  }
  const fields = ACTION_FIELDS[action.kind];
  const record = action as unknown as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== fields.length || keys.some((key, i) => key !== fields[i])) {
    throw badRequest('Campos da ação financeira inválidos');
  }
  const normalized: Record<string, unknown> = {};
  for (const key of fields) {
    const value = record[key];
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw badRequest('Valor financeiro inválido');
    }
    if (value === undefined || (value !== null && !['string', 'number', 'boolean'].includes(typeof value))) {
      throw badRequest('Campos da ação financeira inválidos');
    }
    normalized[key] = value;
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function validateCommand(input: CommitFinanceOperationInput) {
  const { userId, clientId, idempotencyKey, intentNonce, payloadDigest, action } = input;
  if (
    typeof userId !== 'string' || !userId ||
    typeof clientId !== 'string' || !clientId || clientId.length > 256 ||
    typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 200 ||
    typeof intentNonce !== 'string' || !intentNonce || intentNonce.length > 200 ||
    typeof payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(payloadDigest)
  ) {
    throw badRequest('Identificadores da operação financeira inválidos');
  }
  const expected = Buffer.from(digestFinanceAction(action), 'hex');
  const supplied = Buffer.from(payloadDigest, 'hex');
  if (!timingSafeEqual(expected, supplied)) {
    throw badRequest('O resumo da operação não corresponde à ação financeira');
  }
}

function persistedResult(value: Prisma.JsonValue): FinanceActionResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid persisted finance operation result');
  }
  const result = value as Record<string, unknown>;
  if (
    !['receive_income', 'receive_and_save', 'deposit_existing_cash'].includes(String(result.kind)) ||
    !Number.isSafeInteger(result.amountCents) ||
    !['entryId', 'receiptId', 'tagId', 'piggyTransactionId', 'expenseId'].every(
      (field) => result[field] === null || (typeof result[field] === 'string' && result[field] !== ''),
    )
  ) {
    throw new Error('Invalid persisted finance operation result');
  }
  return result as FinanceActionResult;
}

/** Always resolve an uncertain network outcome using the original key. */
export async function getCommittedOperation(
  userId: string,
  clientId: string,
  idempotencyKey: string,
): Promise<CommittedOperationStatus | null> {
  if (!userId || !clientId || !idempotencyKey) return null;
  const operation = await prisma.financeMcpOperation.findUnique({
    where: { userId_clientId_idempotencyKey: { userId, clientId, idempotencyKey } },
    select: { result: true, committedAt: true, undo: { select: { undoneAt: true } } },
  });
  if (!operation) return null;
  return {
    status: operation.undo ? 'undone' : 'committed',
    result: persistedResult(operation.result),
    committedAt: operation.committedAt,
    undoneAt: operation.undo?.undoneAt ?? null,
  };
}

/**
 * The two unique keys and the user row lock prevent replay across concurrent
 * connections. Both the requested accounting writes and the immutable receipt
 * commit or roll back together in a single Prisma transaction.
 */
export async function commitFinanceOperation(
  input: CommitFinanceOperationInput,
): Promise<{ replayed: boolean; result: FinanceActionResult }> {
  validateCommand(input);
  const { userId, clientId, idempotencyKey, intentNonce, payloadDigest, action } = input;

  // Exactly like the website's piggy operation: close any due automatic debits
  // and CDI interest BEFORE taking the requested money movement's DB lock.
  // Preview remains read-only. Replays skip this unrelated catch-up, while the
  // in-transaction checks below still enforce the original key/nonce/digest.
  if (action.kind !== 'receive_income') {
    const alreadyCommitted = await getCommittedOperation(userId, clientId, idempotencyKey);
    if (!alreadyCommitted) {
      await withFreshInterest(userId, async () => undefined);
    }
  }

  return withUserWriteLockTransaction(userId, async (tx) => {
    const byKey = await tx.financeMcpOperation.findUnique({
      where: { userId_clientId_idempotencyKey: { userId, clientId, idempotencyKey } },
      include: { undo: true },
    });
    if (byKey) {
      if (byKey.undo) throw conflict('Operação já desfeita; consulte o histórico.');
      if (byKey.payloadDigest !== payloadDigest || byKey.intentNonce !== intentNonce) {
        throw conflict('Chave de idempotência reutilizada para outra intenção financeira');
      }
      return { replayed: true, result: persistedResult(byKey.result) };
    }

    const byNonce = await tx.financeMcpOperation.findUnique({
      where: { userId_clientId_intentNonce: { userId, clientId, intentNonce } },
      select: { idempotencyKey: true },
    });
    if (byNonce) {
      throw conflict('Intenção financeira já executada; consulte a chave original para confirmar o resultado');
    }

    const result = await runFinanceOperationInTransaction(tx, userId, action);
    await tx.financeMcpOperation.create({
      data: {
        userId,
        clientId,
        idempotencyKey,
        intentNonce,
        payloadDigest,
        actionKind: result.kind,
        amountCents: BigInt(result.amountCents),
        result: result as unknown as Prisma.InputJsonValue,
      },
    });
    return { replayed: false, result };
  });
}

/** The MCP history includes only this OAuth client's operations, never another client's. */
export async function getRecentFinanceOperations(userId: string, clientId: string) {
  const rows = await prisma.financeMcpOperation.findMany({
    where: { userId, clientId },
    include: { undo: { select: { undoneAt: true } } },
    orderBy: [{ committedAt: 'desc' }, { id: 'desc' }],
    take: 20,
  });
  return rows.map((row) => ({
    operationId: row.id,
    idempotencyKey: row.idempotencyKey,
    kind: row.actionKind,
    amountBrl: new Prisma.Decimal(row.amountCents.toString()).div(100).toFixed(2),
    status: row.undo ? 'undone' as const : 'committed' as const,
    committedAt: row.committedAt,
    undoneAt: row.undo?.undoneAt ?? null,
  }));
}

type UndoFinanceInput = {
  userId: string;
  clientId: string;
  operationId: string;
  originalKey: string;
  intentNonce: string;
};

/**
 * Fail-closed reversal. Never remove unrelated records or untracked dependent
 * events. The user lock covers validation, deletion and the immutable audit.
 */
export async function undoFinanceOperation(input: UndoFinanceInput) {
  const { userId, clientId, operationId, originalKey, intentNonce } = input;
  if (![userId, clientId, operationId, originalKey, intentNonce].every(
    (value) => typeof value === 'string' && value.length > 0 && value.length <= 256,
  )) throw badRequest('Identificadores do desfazer inválidos');

  return withUserWriteLockTransaction(userId, async (tx) => {
    const original = await tx.financeMcpOperation.findFirst({
      where: { id: operationId, userId, clientId, idempotencyKey: originalKey },
      include: { undo: true },
    });
    if (!original) throw notFound('Operação do MCP não encontrada para este aplicativo');
    if (original.undo) return { status: 'undone' as const, replayed: true };

    const result = persistedResult(original.result);
    const amount = new Prisma.Decimal(result.amountCents).div(100);
    const changed = () => conflict('Desfazer bloqueado: o lançamento foi alterado ou possui uma dependência posterior');
    if (
      result.kind !== original.actionKind ||
      result.amountCents <= 0 ||
      BigInt(result.amountCents) !== original.amountCents ||
      (result.kind === 'receive_income' &&
        (!result.entryId || !result.receiptId || result.piggyTransactionId || result.expenseId)) ||
      (result.kind === 'receive_and_save' &&
        (!result.entryId || !result.receiptId || !result.piggyTransactionId || !result.expenseId)) ||
      (result.kind === 'deposit_existing_cash' &&
        (!result.piggyTransactionId || result.entryId || result.receiptId || result.tagId))
    ) throw changed();

    let bankId: string | null = null;
    let bankWasCompleted = false;
    if (result.piggyTransactionId) {
      const movement = await tx.piggyTransaction.findFirst({
        where: { id: result.piggyTransactionId, userId },
        include: { piggyBank: true },
      });
      if (
        !movement || movement.type !== 'deposit' || movement.source !== 'manual' ||
        !movement.amount.equals(amount) || movement.expenseId !== result.expenseId ||
        movement.entryId !== null || movement.piggyBank.archivedAt !== null ||
        movement.piggyBank.yieldEnabled || movement.piggyBank.interestAccruedThrough ||
        movement.piggyBank.updatedAt > original.committedAt
      ) throw changed();
      // Later deposits, withdrawals or CDI accruals make ledger reversal unsafe.
      const later = await tx.piggyTransaction.findFirst({
        where: {
          userId, piggyBankId: movement.piggyBankId,
          id: { not: movement.id },
          createdAt: { gte: original.committedAt },
        },
        select: { id: true },
      });
      if (later) throw conflict('Desfazer bloqueado: movimentação posterior no cofrinho');
      bankId = movement.piggyBankId;
      bankWasCompleted = movement.piggyBank.completedAt !== null;
      if (bankWasCompleted && movement.piggyBank.completedAt?.getTime() !== movement.date.getTime()) throw changed();
    } else if (result.kind !== 'receive_income') {
      throw changed();
    }

    if (result.expenseId) {
      const expense = await tx.expense.findFirst({
        where: { id: result.expenseId, userId },
        include: { splits: true, payments: true, piggyTransactions: true, assetTransaction: true },
      });
      if (
        !expense || expense.systemOrigin !== 'piggy' || expense.category !== 'cofrinho' ||
        expense.frequency !== 'unica' || expense.archivedAt ||
        !expense.amount.equals(amount) || expense.updatedAt > original.committedAt ||
        expense.splits.length || expense.payments.length || expense.assetTransaction ||
        expense.piggyTransactions.length !== 1 ||
        expense.piggyTransactions[0].id !== result.piggyTransactionId
      ) throw changed();
    } else if (result.piggyTransactionId &&
      result.kind === 'receive_and_save') {
      throw changed();
    }

    if (result.entryId) {
      const entry = await tx.entry.findFirst({
        where: { id: result.entryId, userId },
        include: { receipts: true, piggyTransactions: true, assetTransaction: true },
      });
      if (
        !entry || entry.systemOrigin !== 'manual' || entry.frequency !== 'unica' ||
        entry.archivedAt || !entry.amount.equals(amount) ||
        entry.updatedAt > original.committedAt || entry.piggyTransactions.length ||
        entry.assetTransaction || entry.receipts.length !== 1 ||
        entry.receipts[0].id !== result.receiptId ||
        !entry.receipts[0].amount.equals(amount)
      ) throw changed();
    } else if (result.receiptId || result.kind !== 'deposit_existing_cash') {
      throw changed();
    }

    if (result.piggyTransactionId &&
      (await tx.piggyTransaction.deleteMany({ where: { id: result.piggyTransactionId, userId } })).count !== 1) throw changed();
    if (result.expenseId &&
      (await tx.expense.deleteMany({ where: { id: result.expenseId, userId } })).count !== 1) throw changed();
    if (result.receiptId &&
      (await tx.entryReceipt.deleteMany({ where: { id: result.receiptId, entryId: result.entryId! } })).count !== 1) throw changed();
    if (result.entryId &&
      (await tx.entry.deleteMany({ where: { id: result.entryId, userId } })).count !== 1) throw changed();
    if (bankId && bankWasCompleted) {
      await tx.piggyBank.update({ where: { id: bankId }, data: { completedAt: null } });
    }
    // Tags may be shared with other transactions; undo deliberately retains them.
    await tx.financeMcpUndo.create({ data: {
      userId, clientId, operationId, intentNonce,
    } });
    return { status: 'undone' as const, replayed: false };
  });
}
