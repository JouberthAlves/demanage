/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';

import type { User } from '@/generated/prisma/client';
import { AppError } from '@/http/errors';
import { AUTH_COOKIE_NAME } from '@/lib/auth';

import { createRequireAuth } from './require-auth';

const user = {
  id: 'u1',
  name: 'Ana',
  email: 'ana@example.invalid',
  passwordHash: 'x',
  recoveryCodeHash: null,
  salary: 0,
  notes: null,
  sessionVersion: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as User;

async function run(
  cookie: string | undefined,
  deps: Parameters<typeof createRequireAuth>[0],
) {
  const req = {
    cookies: cookie ? { [AUTH_COOKIE_NAME]: cookie } : {},
  } as unknown as Request;
  const calls: unknown[] = [];
  await createRequireAuth(deps)(req, {} as Response, (error?: unknown) => {
    calls.push(error);
  });
  return { req, calls };
}

const okVerify = () => ({ userId: 'u1', sessionVersion: 2 });

test('token failures are 401', async () => {
  const missing = await run(undefined, {
    verifyToken: okVerify,
    findUser: async () => user,
  });
  assert.equal((missing.calls[0] as AppError).status, 401);

  const invalid = await run('bad', {
    verifyToken: () => {
      throw new Error('jwt malformed');
    },
    findUser: async () => user,
  });
  assert.equal((invalid.calls[0] as AppError).status, 401);

  const revoked = await run('tok', {
    verifyToken: () => ({ userId: 'u1', sessionVersion: 1 }),
    findUser: async () => user,
  });
  assert.equal((revoked.calls[0] as AppError).status, 401);

  const unknownUser = await run('tok', {
    verifyToken: okVerify,
    findUser: async () => null,
  });
  assert.equal((unknownUser.calls[0] as AppError).status, 401);
});

test('database errors are forwarded instead of becoming 401', async () => {
  const failure = new Error('connection refused');
  const { calls } = await run('tok', {
    verifyToken: okVerify,
    findUser: async () => {
      throw failure;
    },
  });
  assert.equal(calls[0], failure);
});

test('a valid session attaches the public user and continues', async () => {
  const { req, calls } = await run('tok', {
    verifyToken: okVerify,
    findUser: async () => user,
  });
  assert.deepEqual(calls, [undefined]);
  assert.equal(req.user?.id, 'u1');
});
