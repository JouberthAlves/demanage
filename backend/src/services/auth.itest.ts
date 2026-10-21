import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { AppError } from '@/http/errors';
import { comparePassword } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hashRecoveryCode } from '@/lib/recovery-code';

import { recoverPassword } from './auth';

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
