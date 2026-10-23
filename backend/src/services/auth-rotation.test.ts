/* eslint-disable simple-import-sort/imports -- db-env must initialize before Prisma imports. */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/http/errors';
import { comparePassword, hashPassword } from '@/lib/auth';
import { hashRecoveryCode } from '@/lib/recovery-code';

import { recoverPassword, rotateRecoveryCodeInTransaction } from './auth';

const initialCode = '23456-789AB-CDEFG-HJKLM';
const email = 'rotate-race@example.invalid';
const userId = 'rotate-race-user';
const originalPassword = 'ValidOldPassword123!';
const resetPassword = 'ValidResetPassword123!';

type State = {
  passwordHash: string;
  recoveryCodeHash: string | null;
  recoveryCodeCreatedAt: Date | null;
  sessionVersion: number;
};

type Conditions = {
  id: string;
  passwordHash?: string;
  recoveryCodeHash?: string | null;
  sessionVersion?: number;
};

type Changes = {
  passwordHash?: string;
  recoveryCodeHash?: string;
  recoveryCodeCreatedAt?: Date;
  sessionVersion?: { increment: number };
};

function applyConditionalUpdate(state: State, where: Conditions, data: Changes) {
  if (where.id !== userId ||
    (where.passwordHash !== undefined && where.passwordHash !== state.passwordHash) ||
    (where.recoveryCodeHash !== undefined && where.recoveryCodeHash !== state.recoveryCodeHash) ||
    (where.sessionVersion !== undefined && where.sessionVersion !== state.sessionVersion)) {
    return { count: 0 };
  }
  if (data.passwordHash !== undefined) state.passwordHash = data.passwordHash;
  if (data.recoveryCodeHash !== undefined) state.recoveryCodeHash = data.recoveryCodeHash;
  if (data.recoveryCodeCreatedAt !== undefined) state.recoveryCodeCreatedAt = data.recoveryCodeCreatedAt;
  if (data.sessionVersion !== undefined) state.sessionVersion += data.sessionVersion.increment;
  return { count: 1 };
}

test('S01: password recovery wins after rotation reads old credentials; rotation must not publish', async () => {
  const state: State = {
    passwordHash: await hashPassword(originalPassword),
    recoveryCodeHash: hashRecoveryCode(initialCode),
    recoveryCodeCreatedAt: new Date('2026-10-01T12:00:00.000Z'),
    sessionVersion: 7,
  };
  let resumeRotation = () => {};
  const rotationCanContinue = new Promise<void>((resolve) => { resumeRotation = resolve; });
  let rotationHasRead = () => {};
  const rotationRead = new Promise<void>((resolve) => { rotationHasRead = resolve; });

  const rotatingStore = {
    async findUnique() {
      const snapshot = { id: userId, ...state };
      rotationHasRead();
      await rotationCanContinue;
      return snapshot;
    },
    async updateMany({ where, data }: { where: Conditions; data: Changes }) {
      return applyConditionalUpdate(state, where, data);
    },
  } as unknown as Parameters<typeof rotateRecoveryCodeInTransaction>[2];

  const recoveringStore = {
    async findUnique() { return { id: userId, email, ...state }; },
    async updateMany({ where, data }: { where: Conditions; data: Changes }) {
      return applyConditionalUpdate(state, where, data);
    },
  } as unknown as NonNullable<Parameters<typeof recoverPassword>[1]>;

  const pendingRotation = rotateRecoveryCodeInTransaction(userId, originalPassword, rotatingStore);
  try {
    await rotationRead;
    const nextRecoveryCode = await recoverPassword({
      email,
      recoveryCode: initialCode,
      newPassword: resetPassword,
    }, recoveringStore);
    const timestampAfterRecovery = state.recoveryCodeCreatedAt;
    resumeRotation();

    await assert.rejects(pendingRotation, (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 401);
      assert.equal(error.message, 'Senha atual inválida');
      return true;
    });
    assert.equal(state.sessionVersion, 8);
    assert.equal(state.recoveryCodeHash, hashRecoveryCode(nextRecoveryCode));
    assert.equal(state.recoveryCodeCreatedAt, timestampAfterRecovery);
    assert.equal(await comparePassword(resetPassword, state.passwordHash), true);
    assert.equal(await comparePassword(originalPassword, state.passwordHash), false);
  } finally {
    resumeRotation();
  }
});

test('S01: each changed credential/version independently rejects stale rotation CAS', async () => {
  for (const changed of ['passwordHash', 'sessionVersion', 'recoveryCodeHash'] as const) {
    const state: State = {
      passwordHash: await hashPassword(originalPassword),
      recoveryCodeHash: hashRecoveryCode(initialCode),
      recoveryCodeCreatedAt: new Date('2026-10-01T12:00:00.000Z'),
      sessionVersion: 4,
    };
    let expectedAfterInterleaving: State | null = null;
    const store = {
      async findUnique() {
        const snapshot = { id: userId, ...state };
        if (changed === 'passwordHash') state.passwordHash = await hashPassword('OtherPassword123!');
        if (changed === 'sessionVersion') state.sessionVersion += 1;
        if (changed === 'recoveryCodeHash') state.recoveryCodeHash = hashRecoveryCode('BCDEF-23456-789AB-CDEFG');
        expectedAfterInterleaving = { ...state };
        return snapshot;
      },
      async updateMany({ where, data }: { where: Conditions; data: Changes }) {
        return applyConditionalUpdate(state, where, data);
      },
    } as unknown as Parameters<typeof rotateRecoveryCodeInTransaction>[2];
    await assert.rejects(rotateRecoveryCodeInTransaction(userId, originalPassword, store), (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 401);
      return true;
    }, `rotation should reject a changed ${changed}`);
    assert.deepEqual(state, expectedAfterInterleaving, `failed rotation mutated ${changed}`);
  }
});

test('S01: valid current password rotates exactly once without revoking the session', async () => {
  const state: State = {
    passwordHash: await hashPassword(originalPassword),
    recoveryCodeHash: hashRecoveryCode(initialCode),
    recoveryCodeCreatedAt: null,
    sessionVersion: 10,
  };
  const store = {
    async findUnique() { return { id: userId, ...state }; },
    async updateMany({ where, data }: { where: Conditions; data: Changes }) {
      return applyConditionalUpdate(state, where, data);
    },
  } as unknown as Parameters<typeof rotateRecoveryCodeInTransaction>[2];
  const code = await rotateRecoveryCodeInTransaction(userId, originalPassword, store);
  assert.notEqual(code, initialCode);
  assert.equal(state.recoveryCodeHash, hashRecoveryCode(code));
  assert.equal(state.sessionVersion, 10);
  assert.ok(state.recoveryCodeCreatedAt instanceof Date);
});
