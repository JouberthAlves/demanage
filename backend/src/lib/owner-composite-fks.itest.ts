import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

function foreignKeyViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}

test('C04: a user cannot persist a piggy transaction against a foreign bank', async () => {
  const [owner, other] = await Promise.all(
    ['owner', 'other'].map((name) =>
      prisma.user.create({
        data: {
          name,
          email: `c04-bank-${name}-${randomUUID()}@example.invalid`,
          passwordHash: 'test-only',
        },
      }),
    ),
  );
  try {
    const foreignBank = await prisma.piggyBank.create({
      data: { userId: other.id, name: 'Foreign bank', monthlyGoal: 0 },
    });
    const ownBank = await prisma.piggyBank.create({
      data: { userId: owner.id, name: 'Own bank', monthlyGoal: 0 },
    });
    const movement = {
      userId: owner.id,
      type: 'deposit' as const,
      source: 'manual' as const,
      amount: 10,
      date: new Date('2026-10-01T12:00:00Z'),
    };
    await assert.rejects(
      prisma.piggyTransaction.create({
        data: { ...movement, piggyBankId: foreignBank.id },
      }),
      foreignKeyViolation,
    );
    const accepted = await prisma.piggyTransaction.create({
      data: { ...movement, piggyBankId: ownBank.id },
    });
    assert.equal(accepted.userId, owner.id);
    await prisma.piggyBank.delete({ where: { id: ownBank.id } });
    assert.equal(
      await prisma.piggyTransaction.count({ where: { id: accepted.id } }),
      0,
    );
  } finally {
    await prisma.user.deleteMany({
      where: { id: { in: [owner.id, other.id] } },
    });
  }
});

test('C04: undo receipt must reference an MCP operation of the same user', async () => {
  const [owner, other] = await Promise.all(
    ['owner', 'other'].map((name) =>
      prisma.user.create({
        data: {
          name,
          email: `c04-undo-${name}-${randomUUID()}@example.invalid`,
          passwordHash: 'test-only',
        },
      }),
    ),
  );
  try {
    const original = await prisma.financeMcpOperation.create({
      data: {
        userId: other.id,
        clientId: 'client-test',
        idempotencyKey: randomUUID(),
        intentNonce: randomUUID(),
        payloadDigest: 'digest-test',
        actionKind: 'receive_income',
        amountCents: 1000n,
        result: { kind: 'receive_income', amountCents: 1000 },
      },
    });
    await assert.rejects(
      prisma.financeMcpUndo.create({
        data: {
          userId: owner.id,
          clientId: 'client-test',
          intentNonce: randomUUID(),
          operationId: original.id,
        },
      }),
      foreignKeyViolation,
    );
    const accepted = await prisma.financeMcpUndo.create({
      data: {
        userId: other.id,
        clientId: 'client-test',
        intentNonce: randomUUID(),
        operationId: original.id,
      },
    });
    assert.equal(accepted.operationId, original.id);
    await prisma.financeMcpOperation.delete({ where: { id: original.id } });
    assert.equal(
      await prisma.financeMcpUndo.count({ where: { id: accepted.id } }),
      0,
    );
  } finally {
    await prisma.user.deleteMany({
      where: { id: { in: [owner.id, other.id] } },
    });
  }
});
