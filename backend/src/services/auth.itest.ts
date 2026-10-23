import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { AppError } from '@/http/errors';
import { comparePassword, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hashRecoveryCode } from '@/lib/recovery-code';

import { recoverPassword, rotateRecoveryCodeInTransaction } from './auth';

test('PostgreSQL permits only one recovery per code, rotating it and revoking sessions', async () => {
  const recoveryCode = '23456-789AB-CDEFG-HJKLM';
  const email = `recover-${randomUUID()}@example.invalid`;
  const user = await prisma.user.create({
    data: {
      name: 'Recovery test user',
      email,
      passwordHash: 'old-test-only-password-hash',
      recoveryCodeHash: hashRecoveryCode(recoveryCode),
    },
  });

  try {
    const passwords = ['ValidPassword123!', 'AnotherPassword123!'];
    const outcomes = await Promise.allSettled(
      passwords.map((newPassword) =>
        recoverPassword({ email, recoveryCode, newPassword }),
      ),
    );
    const winners = outcomes.flatMap((result, index) =>
      result.status === 'fulfilled' ? [{ index, code: result.value }] : [],
    );
    const losers = outcomes.filter((result) => result.status === 'rejected');
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    const loser = losers[0] as PromiseRejectedResult;
    assert.ok(loser.reason instanceof AppError);
    assert.equal(loser.reason.status, 401);
    assert.equal(
      loser.reason.message,
      'E-mail ou código de recuperação inválidos',
    );

    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    assert.equal(updated.sessionVersion, user.sessionVersion + 1);
    assert.equal(updated.recoveryCodeHash, hashRecoveryCode(winners[0].code));
    assert.equal(
      await comparePassword(passwords[winners[0].index], updated.passwordHash),
      true,
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('PostgreSQL rejects a rotation after a concurrent password reset commits', async () => {
  const code = '23456-789AB-CDEFG-HJKLM';
  const email = `rotate-race-${randomUUID()}@example.invalid`;
  const originalPassword = 'OriginalPassword123!';
  const newPassword = 'UpdatedPassword123!';
  const user = await prisma.user.create({
    data: {
      name: 'Rotation race',
      email,
      passwordHash: await hashPassword(originalPassword),
      recoveryCodeHash: hashRecoveryCode(code),
    },
  });

  let resume = () => {};
  const canResume = new Promise<void>((resolve) => { resume = resolve; });
  let observed = () => {};
  const readCompleted = new Promise<void>((resolve) => { observed = resolve; });

  const rotation = prisma.$transaction(async (tx) => {
    const store = {
      async findUnique() {
        const snapshot = await tx.user.findUnique({
          where: { id: user.id },
          select: { passwordHash: true, sessionVersion: true, recoveryCodeHash: true },
        });
        observed();
        await canResume;
        return snapshot;
      },
      updateMany: (args: Parameters<typeof tx.user.updateMany>[0]) => tx.user.updateMany(args),
    } as unknown as Pick<typeof prisma.user, 'findUnique' | 'updateMany'>;
    return rotateRecoveryCodeInTransaction(user.id, originalPassword, store);
  }, { maxWait: 10_000, timeout: 30_000 });

  try {
    await readCompleted;
    const nextCode = await recoverPassword({ email, recoveryCode: code, newPassword });
    resume();
    await assert.rejects(rotation, (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 401);
      return true;
    });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(updated.sessionVersion, user.sessionVersion + 1);
    assert.equal(updated.recoveryCodeHash, hashRecoveryCode(nextCode));
    assert.equal(await comparePassword(newPassword, updated.passwordHash), true);
  } finally {
    resume();
    await rotation.catch(() => {});
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('password recovery revokes all OAuth consent and grant artifacts atomically', async () => {
  const recoveryCode = '23456-789AB-CDEFG-HJKLM';
  const email = `oauth-recover-${randomUUID()}@example.invalid`;
  const user = await prisma.user.create({
    data: {
      name: 'OAuth recovery test user', email, passwordHash: 'old-test-only-hash',
      recoveryCodeHash: hashRecoveryCode(recoveryCode),
    },
  });
  const grants = [`grant-${randomUUID()}`, `grant-${randomUUID()}`];
  try {
    for (let i = 0; i < grants.length; i++) {
      await prisma.oAuthConnection.create({ data: {
        userId: user.id, clientId: `client-${i}`, clientName: `Client ${i}`,
        grantId: grants[i], scopes: 'finance:read',
      } });
      await prisma.oAuthArtifact.createMany({ data: [
        { model: 'Grant', id: grants[i], payload: { accountId: user.id } },
        { model: 'AccessToken', id: `token-${i}`, grantId: grants[i], payload: { grantId: grants[i] } },
        { model: 'RefreshToken', id: `refresh-${i}`, grantId: grants[i], payload: { grantId: grants[i] } },
      ] });
    }
    await recoverPassword({ email, recoveryCode, newPassword: 'SecureNewPassword123!' });
    assert.equal(await prisma.oAuthConnection.count({ where: { userId: user.id, revokedAt: null } }), 0);
    assert.equal(await prisma.oAuthArtifact.count({ where: { OR: [
      { grantId: { in: grants } }, { model: 'Grant', id: { in: grants } },
    ] } }), 0);
    const connections = await prisma.oAuthConnection.findMany({ where: { userId: user.id } });
    assert.ok(connections.every((connection) => connection.revokedAt !== null));
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
