/* eslint-disable simple-import-sort/imports -- db-env must initialize before Prisma imports. */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';

import { AppError } from '@/http/errors';
import { hashPassword } from '@/lib/auth';

import { authenticate } from './auth';

test('missing and existing-email wrong passwords both run comparable bcrypt work and return the same 401', async () => {
  const knownHash = await hashPassword('Correct-password-for-unit-test');
  const absentStore = { findUnique: async () => null } as unknown as Parameters<
    typeof authenticate
  >[2];
  const existingStore = {
    findUnique: async () => ({
      id: 'unit-user',
      email: 'registered@example.invalid',
      passwordHash: knownHash,
      sessionVersion: 0,
    }),
  } as unknown as Parameters<typeof authenticate>[2];

  async function sample(store: Parameters<typeof authenticate>[2]) {
    const started = performance.now();
    await assert.rejects(
      authenticate('registered@example.invalid', 'wrong-password', store),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.status, 401);
        assert.equal(error.message, 'E-mail ou senha inválidos');
        return true;
      },
    );
    return performance.now() - started;
  }

  const missing: number[] = [];
  const existing: number[] = [];
  for (let i = 0; i < 3; i++) {
    missing.push(await sample(absentStore));
    existing.push(await sample(existingStore));
  }
  missing.sort((a, b) => a - b);
  existing.sort((a, b) => a - b);
  const ratio = missing[1] / existing[1];
  assert.ok(
    ratio > 0.3 && ratio < 3.5,
    `bcrypt cost should be comparable, measured median ratio ${ratio}`,
  );

  const user = await authenticate(
    'registered@example.invalid',
    'Correct-password-for-unit-test',
    existingStore,
  );
  assert.equal(user.id, 'unit-user');
});
