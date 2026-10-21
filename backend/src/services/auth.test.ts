/* eslint-disable simple-import-sort/imports -- db-env must initialize before Prisma imports. */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/http/errors';
import { comparePassword } from '@/lib/auth';
import { hashRecoveryCode } from '@/lib/recovery-code';

import { recoverPassword } from './auth';

const initialCode = '23456-789AB-CDEFG-HJKLM';
const email = 'recovery-test@example.invalid';

function recoveryStore(waitForBothReads = false) {
  const state = {
    recoveryCodeHash: hashRecoveryCode(initialCode),
    passwordHash: 'old-password-hash',
    sessionVersion: 0,
  };
  let reads = 0;
  let releaseReads: () => void = () => {};
  const bothRead = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });

  type Write = {
    passwordHash: string;
    recoveryCodeHash: string;
    sessionVersion: { increment: number };
  };
  const apply = (data: Write) => {
    state.passwordHash = data.passwordHash;
    state.recoveryCodeHash = data.recoveryCodeHash;
    state.sessionVersion += data.sessionVersion.increment;
  };

  const store = {
    async findUnique({ where }: { where: { email: string } }) {
      if (where.email !== email) return null;
      const snapshot = {
        id: 'test-user',
        recoveryCodeHash: state.recoveryCodeHash,
      };
      if (waitForBothReads) {
        reads += 1;
        if (reads === 2) releaseReads();
        await bothRead;
      }
      return snapshot;
    },
    async update({ data }: { data: Write }) {
      apply(data);
      return { id: 'test-user' };
    },
    async updateMany({
      where,
      data,
    }: {
      where: { id: string; recoveryCodeHash: string };
      data: Write;
    }) {
      if (
        where.id !== 'test-user' ||
        where.recoveryCodeHash !== state.recoveryCodeHash
      ) {
        return { count: 0 };
      }
      apply(data);
      return { count: 1 };
    },
  } as unknown as NonNullable<Parameters<typeof recoverPassword>[1]>;

  return { state, store };
}

test('simultaneous recovery requests consume a code exactly once', async () => {
  const { state, store } = recoveryStore(true);
  const results = await Promise.allSettled([
    recoverPassword(
      { email, recoveryCode: initialCode, newPassword: 'ValidPassword123!' },
      store,
    ),
    recoverPassword(
      { email, recoveryCode: initialCode, newPassword: 'OtherPassword123!' },
      store,
    ),
  ]);

  const winners = results.filter((result) => result.status === 'fulfilled');
  const losers = results.filter((result) => result.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  const rejected = losers[0] as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof AppError);
  assert.equal(rejected.reason.status, 401);
  assert.equal(
    rejected.reason.message,
    'E-mail ou código de recuperação inválidos',
  );
  assert.equal(state.sessionVersion, 1);
  assert.equal(
    state.recoveryCodeHash,
    hashRecoveryCode((winners[0] as PromiseFulfilledResult<string>).value),
  );
});

test('a recovery code is rejected on sequential reuse', async () => {
  const { state, store } = recoveryStore();
  const input = {
    email,
    recoveryCode: initialCode,
    newPassword: 'ValidPassword123!',
  };
  await recoverPassword(input, store);
  await assert.rejects(recoverPassword(input, store), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(state.sessionVersion, 1);
});

test('valid recovery rotates the code and revokes previous sessions', async () => {
  const { state, store } = recoveryStore();
  const nextCode = await recoverPassword(
    { email, recoveryCode: initialCode, newPassword: 'ValidPassword123!' },
    store,
  );
  assert.notEqual(hashRecoveryCode(nextCode), hashRecoveryCode(initialCode));
  assert.equal(state.recoveryCodeHash, hashRecoveryCode(nextCode));
  assert.equal(
    await comparePassword('ValidPassword123!', state.passwordHash),
    true,
  );
  assert.equal(state.sessionVersion, 1);
});
