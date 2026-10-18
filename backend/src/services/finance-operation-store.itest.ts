import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { addDaysToKey, dayKeyToDate, todayKeyInSaoPaulo } from '@/lib/civil-date';
import { prisma } from '@/lib/prisma';

import type { FinanceAction } from './finance-operation';
import {
  commitFinanceOperation,
  digestFinanceAction,
  getCommittedOperation,
  getRecentFinanceOperations,
  undoFinanceOperation,
} from './finance-operation-store';

async function createTestUser() {
  return prisma.user.create({
    data: {
      name: 'Finance idempotency test',
      email: `finance-store-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only',
    },
  });
}

async function removeTestUser(userId: string) {
  await prisma.entryReceipt.deleteMany({ where: { entry: { userId } } });
  await prisma.piggyTransaction.deleteMany({ where: { userId } });
  await prisma.expense.deleteMany({ where: { userId } });
  await prisma.entry.deleteMany({ where: { userId } });
  await prisma.piggyBank.deleteMany({ where: { userId } });
  await prisma.customTag.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

function gift(bankId: string): FinanceAction {
  return {
    kind: 'receive_and_save',
    amountCents: 2_000,
    dateKey: '2026-10-16',
    description: 'Presente da minha vó',
    tagName: 'Presente',
    bankId,
  };
}

function input(userId: string, action: FinanceAction, overrides: Partial<Parameters<typeof commitFinanceOperation>[0]> = {}) {
  return {
    userId,
    clientId: 'mcp-client-A',
    idempotencyKey: `key-${randomUUID()}`,
    intentNonce: `nonce-${randomUUID()}`,
    payloadDigest: digestFinanceAction(action),
    action,
    ...overrides,
  };
}

test('ten concurrent exact repeats commit a single entry, receipt, tag, expense, piggy deposit, and audit', async () => {
  const user = await createTestUser();
  const bank = await prisma.piggyBank.create({ data: { userId: user.id, name: 'Porco', monthlyGoal: 0 } });
  try {
    const command = input(user.id, gift(bank.id));
    const results = await Promise.all(
      Array.from({ length: 10 }, () => commitFinanceOperation(command)),
    );
    assert.equal(results.filter((outcome) => !outcome.replayed).length, 1);
    assert.equal(results.filter((outcome) => outcome.replayed).length, 9);
    for (const outcome of results) assert.deepEqual(outcome.result, results[0].result);
    const result = results[0].result;
    assert.ok(result.entryId);
    assert.ok(result.receiptId);
    assert.ok(result.tagId);
    assert.ok(result.expenseId);
    assert.ok(result.piggyTransactionId);
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.entryReceipt.count({ where: { entry: { userId: user.id } } }), 1);
    assert.equal(await prisma.customTag.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.expense.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.piggyTransaction.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: user.id } }), 1);

    const status = await getCommittedOperation(user.id, command.clientId, command.idempotencyKey);
    assert.equal(status?.status, 'committed');
    assert.deepEqual(status?.result, result);
    assert.ok(status?.committedAt instanceof Date);
    const audit = await prisma.financeMcpOperation.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(audit.actionKind, 'receive_and_save');
    assert.equal(audit.amountCents, 2_000n);
    assert.equal(audit.payloadDigest, command.payloadDigest);
    assert.equal(audit.intentNonce, command.intentNonce);
    assert.equal(JSON.stringify(audit.result).includes('Presente da minha vó'), false);
  } finally {
    await removeTestUser(user.id);
  }
});

test('same key with different digest or nonce conflicts; same nonce with fresh key cannot post twice', async () => {
  const user = await createTestUser();
  try {
    const action: FinanceAction = { kind: 'receive_income', amountCents: 500, dateKey: '2026-10-16', description: 'test gift', tagName: 'Presente' };
    const command = input(user.id, action);
    const first = await commitFinanceOperation(command);
    assert.equal(first.replayed, false);

    const changedAction = { ...action, amountCents: 600 };
    await assert.rejects(
      commitFinanceOperation({ ...command, action: changedAction, payloadDigest: digestFinanceAction(changedAction) }),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 409,
    );
    await assert.rejects(
      commitFinanceOperation({ ...command, intentNonce: `nonce-${randomUUID()}` }),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 409,
    );
    await assert.rejects(
      commitFinanceOperation({ ...command, idempotencyKey: `key-${randomUUID()}` }),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 409,
    );
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: user.id } }), 1);
  } finally {
    await removeTestUser(user.id);
  }
});

test('concurrent attempts using the same signed-intent nonce and different keys commit only once', async () => {
  const user = await createTestUser();
  try {
    const action: FinanceAction = {
      kind: 'receive_income', amountCents: 2_000, dateKey: '2026-10-16',
      description: 'Presente', tagName: 'Presente',
    };
    const command = input(user.id, action);
    const otherKey = { ...command, idempotencyKey: `key-${randomUUID()}` };
    const outcomes = await Promise.allSettled([
      commitFinanceOperation(command),
      commitFinanceOperation(otherKey),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    assert.ok(rejected && rejected.status === 'rejected');
    assert.equal(rejected.reason.status, 409);
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.entryReceipt.count({ where: { entry: { userId: user.id } } }), 1);
  } finally {
    await removeTestUser(user.id);
  }
});

test('database constraints independently reject key and nonce duplicates from direct inserts', async () => {
  const user = await createTestUser();
  try {
    const base = {
      userId: user.id, clientId: 'test-client', idempotencyKey: `key-${randomUUID()}`,
      intentNonce: `nonce-${randomUUID()}`, payloadDigest: 'b'.repeat(64),
      actionKind: 'receive_income', amountCents: 3_000_000_000n,
      result: { kind: 'receive_income', amountCents: 3_000_000_000, entryId: null,
        receiptId: null, tagId: null, expenseId: null, piggyTransactionId: null },
    };
    await prisma.financeMcpOperation.create({ data: base });
    for (const duplicate of [
      { ...base, intentNonce: `nonce-${randomUUID()}` },
      { ...base, idempotencyKey: `key-${randomUUID()}` },
    ]) {
      await assert.rejects(
        prisma.financeMcpOperation.create({ data: duplicate }),
        (error: unknown) => error instanceof Error && 'code' in error && error.code === 'P2002',
      );
    }
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: user.id } }), 1);
  } finally {
    await removeTestUser(user.id);
  }
});

test('digest uses canonical content and refuses mismatched action without posting any funds', async () => {
  const user = await createTestUser();
  try {
    const action: FinanceAction = { kind: 'receive_income', amountCents: 200, dateKey: '2026-10-16', description: 'note', tagName: null };
    assert.equal(digestFinanceAction(action), digestFinanceAction({ tagName: null, description: 'note', dateKey: '2026-10-16', amountCents: 200, kind: 'receive_income' }));
    const command = input(user.id, action);
    await assert.rejects(
      commitFinanceOperation({ ...command, payloadDigest: 'a'.repeat(64) }),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 400,
    );
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 0);
  } finally {
    await removeTestUser(user.id);
  }
});

test('failure late in accounting rolls back audit, tag, receipt and money; failed key can safely retry', async () => {
  const user = await createTestUser();
  const limited = await prisma.piggyBank.create({ data: { userId: user.id, name: 'Limitado', monthlyGoal: 0, goalAmount: 8 } });
  const unlimited = await prisma.piggyBank.create({ data: { userId: user.id, name: 'Livre', monthlyGoal: 0 } });
  try {
    const command = input(user.id, gift(limited.id));
    await assert.rejects(commitFinanceOperation(command));
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.customTag.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.entryReceipt.count({ where: { entry: { userId: user.id } } }), 0);
    assert.equal(await prisma.expense.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.piggyTransaction.count({ where: { userId: user.id } }), 0);
    const newAction = gift(unlimited.id);
    const committed = await commitFinanceOperation({ ...command, action: newAction, payloadDigest: digestFinanceAction(newAction) });
    assert.equal(committed.replayed, false);
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: user.id } }), 1);
  } finally {
    await removeTestUser(user.id);
  }
});

test('operation status and keys are isolated by both user and OAuth client', async () => {
  const [owner, other] = await Promise.all([createTestUser(), createTestUser()]);
  try {
    const action: FinanceAction = { kind: 'receive_income', amountCents: 200, dateKey: '2026-10-16', description: 'present', tagName: null };
    const command = input(owner.id, action);
    const first = await commitFinanceOperation(command);
    assert.equal(first.replayed, false);
    assert.equal(await getCommittedOperation(other.id, command.clientId, command.idempotencyKey), null);
    assert.equal(await getCommittedOperation(owner.id, 'mcp-client-B', command.idempotencyKey), null);
    assert.equal(await getCommittedOperation(owner.id, command.clientId, 'unknown-key'), null);
    const otherClient = await commitFinanceOperation({ ...command, clientId: 'mcp-client-B' });
    const otherUser = await commitFinanceOperation({ ...command, userId: other.id });
    assert.equal(otherClient.replayed, false);
    assert.equal(otherUser.replayed, false);
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: owner.id } }), 2);
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: other.id } }), 1);
  } finally {
    await removeTestUser(owner.id);
    await removeTestUser(other.id);
  }
});

test('MCP settles a due piggy auto-debit before manual posting and rejects a newly capped goal', async () => {
  const user = await createTestUser();
  const today = todayKeyInSaoPaulo();
  const yesterday = dayKeyToDate(addDaysToKey(today, -1));
  const bank = await prisma.piggyBank.create({
    data: {
      userId: user.id,
      name: 'Auto debit before MCP',
      createdAt: yesterday,
      goalAmount: 10,
      monthlyGoal: 6,
      autoDebit: true,
      autoDebitDay: Number(today.slice(-2)),
      autoDebitEnabledAt: yesterday,
    },
  });
  try {
    const action: FinanceAction = {
      kind: 'deposit_existing_cash',
      amountCents: 600,
      dateKey: today,
      bankId: bank.id,
      deductFromBalance: true,
      note: null,
    };
    await assert.rejects(commitFinanceOperation(input(user.id, action)), /meta|cofrinho/i);
    const auto = await prisma.piggyTransaction.findMany({
      where: { userId: user.id, piggyBankId: bank.id },
    });
    assert.equal(auto.length, 1, 'a single due automatic deposit is applied first');
    assert.equal(auto[0].source, 'auto_debit');
    assert.equal(Number(auto[0].amount), 6);
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.expense.count({ where: { userId: user.id } }), 1);
  } finally {
    await removeTestUser(user.id);
  }
});

test('undo removes only the original MCP income and keeps an append-only undo receipt', async () => {
  const user = await createTestUser();
  try {
    const action: FinanceAction = { kind: 'receive_income', amountCents: 1750, dateKey: todayKeyInSaoPaulo(), description: 'disposable income', tagName: null };
    const command = input(user.id, action);
    await commitFinanceOperation(command);
    const operations = await getRecentFinanceOperations(user.id, command.clientId);
    assert.equal(operations.length, 1);
    assert.equal(operations[0].idempotencyKey, command.idempotencyKey);
    assert.equal(operations[0].status, 'committed');
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 1);

    const undo = await undoFinanceOperation({
      userId: user.id, clientId: command.clientId, operationId: operations[0].operationId,
      originalKey: command.idempotencyKey, intentNonce: 'undo-' + randomUUID(),
    });
    assert.equal(undo.replayed, false);
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.entryReceipt.count({ where: { entry: { userId: user.id } } }), 0);
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.financeMcpUndo.count({ where: { userId: user.id } }), 1);
    assert.equal((await getCommittedOperation(user.id, command.clientId, command.idempotencyKey))?.status, 'undone');
    assert.equal((await undoFinanceOperation({
      userId: user.id, clientId: command.clientId, operationId: operations[0].operationId,
      originalKey: command.idempotencyKey, intentNonce: 'undo-' + randomUUID(),
    })).replayed, true);
    await assert.rejects(commitFinanceOperation(command), /desfeita/i);
  } finally {
    await removeTestUser(user.id);
  }
});

test('undo of MCP received-and-saved income atomically restores piggy balance and cash movement', async () => {
  const user = await createTestUser();
  const bank = await prisma.piggyBank.create({ data: { userId: user.id, name: 'Disposable', goalAmount: 20, monthlyGoal: 0 } });
  try {
    const command = input(user.id, { ...gift(bank.id), dateKey: todayKeyInSaoPaulo() });
    await commitFinanceOperation(command);
    const op = (await getRecentFinanceOperations(user.id, command.clientId))[0];
    const undo = await undoFinanceOperation({ userId: user.id, clientId: command.clientId, operationId: op.operationId, originalKey: command.idempotencyKey, intentNonce: 'undo-' + randomUUID() });
    assert.equal(undo.replayed, false);
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.expense.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.piggyTransaction.count({ where: { userId: user.id } }), 0);
    assert.equal((await prisma.piggyBank.findUniqueOrThrow({ where: { id: bank.id } })).completedAt, null);
    assert.equal(await prisma.financeMcpUndo.count({ where: { userId: user.id } }), 1);
  } finally {
    await removeTestUser(user.id);
  }
});

test('undo cannot access another client and refuses dependent records without changing money', async () => {
  const user = await createTestUser();
  const bank = await prisma.piggyBank.create({ data: { userId: user.id, name: 'Dependent', monthlyGoal: 0 } });
  try {
    const command = input(user.id, { ...gift(bank.id), dateKey: todayKeyInSaoPaulo() });
    await commitFinanceOperation(command);
    const op = (await getRecentFinanceOperations(user.id, command.clientId))[0];
    const tryUndo = (clientId = command.clientId) => undoFinanceOperation({
      userId: user.id, clientId, operationId: op.operationId,
      originalKey: command.idempotencyKey, intentNonce: 'undo-' + randomUUID(),
    });
    await assert.rejects(tryUndo('different-mcp-client'));
    await prisma.piggyTransaction.create({ data: { userId: user.id, piggyBankId: bank.id, type: 'deposit', amount: 1, date: new Date(), source: 'manual' } });
    await assert.rejects(tryUndo(), /posterior|dependência|alterad/i);
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.piggyTransaction.count({ where: { userId: user.id } }), 2);
    assert.equal(await prisma.financeMcpUndo.count({ where: { userId: user.id } }), 0);
  } finally {
    await removeTestUser(user.id);
  }
});
