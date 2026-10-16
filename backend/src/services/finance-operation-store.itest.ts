import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';

import type { FinanceAction } from './finance-operation';
import {
  commitFinanceOperation,
  digestFinanceAction,
  getCommittedOperation,
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
