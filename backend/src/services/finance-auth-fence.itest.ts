import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { todayKeyInSaoPaulo } from '@/lib/civil-date';
import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

import {
  commitFinanceOperation,
  digestFinanceAction,
  undoFinanceOperation,
} from './finance-operation-store';

test('S02: financial write and undo authenticated before recovery cannot commit after grant revocation', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'S02 locked revocation',
      email: `s02-fence-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only',
    },
  });
  const clientId = 'mcp-fence-client';
  const grantId = `grant-${randomUUID()}`;
  const action = {
    kind: 'receive_income' as const,
    amountCents: 2_500,
    dateKey: todayKeyInSaoPaulo(),
    description: 'Previously authorized income',
    tagName: null,
  };
  const command = {
    userId: user.id, clientId, oauthGrantId: grantId,
    idempotencyKey: randomUUID(), intentNonce: randomUUID(),
    payloadDigest: digestFinanceAction(action), action,
  };
  let releaseRevocation = () => {};
  let signalLock = () => {};
  const ready = new Promise<void>((resolve) => { signalLock = resolve; });
  const canRevoke = new Promise<void>((resolve) => { releaseRevocation = resolve; });
  let revocation: Promise<void> | undefined;

  try {
    await prisma.oAuthConnection.create({
      data: {
        userId: user.id, clientId, clientName: 'fence test', grantId,
        scopes: 'finance:read finance:write',
      },
    });
    await prisma.oAuthArtifact.create({
      data: {
        model: 'Grant', id: grantId,
        payload: { accountId: user.id, clientId },
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const first = await commitFinanceOperation(command);
    assert.equal(first.replayed, false, 'valid bearer can write before revocation');
    const operation = await prisma.financeMcpOperation.findFirstOrThrow({
      where: { userId: user.id, clientId },
    });
    assert.ok(await prisma.oAuthConnection.findUnique({
      where: { userId_clientId: { userId: user.id, clientId } },
    }), 'MCP identity was authenticated before the reset');

    // Recovery holds the same row lock the operation will need. The token was
    // already authorized, but a delayed financial transaction must fail.
    revocation = withUserWriteLockTransaction(user.id, async (tx) => {
      signalLock();
      await canRevoke;
      await tx.user.update({
        where: { id: user.id }, data: { sessionVersion: { increment: 1 } },
      });
      await tx.oAuthConnection.updateMany({
        where: { userId: user.id, clientId }, data: { revokedAt: new Date() },
      });
      await tx.oAuthArtifact.deleteMany({
        where: { OR: [{ model: 'Grant', id: grantId }, { grantId }] },
      });
    });
    await ready;
    const delayedWrite = commitFinanceOperation({
      ...command, idempotencyKey: randomUUID(), intentNonce: randomUUID(),
    });
    releaseRevocation();
    await revocation;
    await assert.rejects(delayedWrite, (error: unknown) =>
      error instanceof Error && 'status' in error && error.status === 401);

    await assert.rejects(undoFinanceOperation({
      userId: user.id, clientId, oauthGrantId: grantId,
      operationId: operation.id, originalKey: command.idempotencyKey,
      intentNonce: randomUUID(),
    }), (error: unknown) =>
      error instanceof Error && 'status' in error && error.status === 401);
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.financeMcpUndo.count({ where: { userId: user.id } }), 0);
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.entryReceipt.count({ where: { entry: { userId: user.id } } }), 1);
  } finally {
    releaseRevocation();
    await revocation?.catch(() => {});
    await prisma.oAuthArtifact.deleteMany({
      where: { OR: [{ model: 'Grant', id: grantId }, { grantId }] },
    });
    await prisma.financeMcpUndo.deleteMany({ where: { userId: user.id } });
    await prisma.financeMcpOperation.deleteMany({ where: { userId: user.id } });
    await prisma.entryReceipt.deleteMany({ where: { entry: { userId: user.id } } });
    await prisma.entry.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
