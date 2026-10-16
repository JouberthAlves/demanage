import { createHash, timingSafeEqual } from 'node:crypto';

import { Prisma } from '@/generated/prisma/client';
import { badRequest, conflict } from '@/http/errors';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

import {
  type FinanceAction,
  type FinanceActionResult,
  runFinanceOperationInTransaction,
} from './finance-operation';

export type CommitFinanceOperationInput = {
  userId: string;
  clientId: string;
  idempotencyKey: string;
  intentNonce: string;
  payloadDigest: string;
  action: FinanceAction;
};

type CommittedOperationStatus = {
  status: 'committed';
  result: FinanceActionResult;
  committedAt: Date;
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
    select: { result: true, committedAt: true },
  });
  if (!operation) return null;
  return { status: 'committed', result: persistedResult(operation.result), committedAt: operation.committedAt };
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

  return withUserWriteLockTransaction(userId, async (tx) => {
    const byKey = await tx.financeMcpOperation.findUnique({
      where: { userId_clientId_idempotencyKey: { userId, clientId, idempotencyKey } },
    });
    if (byKey) {
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
