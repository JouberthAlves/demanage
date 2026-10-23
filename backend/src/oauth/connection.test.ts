/* eslint-disable simple-import-sort/imports -- fake DATABASE_URL precedes Prisma import. */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Prisma } from '@/generated/prisma/client';
import { AppError } from '@/http/errors';

import { assertOAuthGrantActiveForFinancialWrite } from './connection';

function fakeTx(options: {
  grantId?: string;
  scopes?: string;
  revokedAt?: Date | null;
  grantExpiresAt?: Date | null;
  hasGrant?: boolean;
}) {
  return {
    oAuthConnection: {
      findUnique: async () =>
        options.grantId === undefined
          ? null
          : {
              userId: 'owner',
              clientId: 'client',
              grantId: options.grantId,
              scopes: options.scopes ?? 'finance:read finance:write',
              revokedAt: options.revokedAt ?? null,
            },
    },
    oAuthArtifact: {
      findUnique: async () =>
        options.hasGrant === false
          ? null
          : { expiresAt: options.grantExpiresAt ?? null },
    },
  } as unknown as Prisma.TransactionClient;
}

const context = {
  userId: 'owner',
  clientId: 'client',
  oauthGrantId: 'original-grant',
};

test('S02: stale, revoked, expired or mismatched grant cannot authorize a financial write', async () => {
  for (const options of [
    {},
    { grantId: 'new-grant' },
    { grantId: 'original-grant', revokedAt: new Date() },
    { grantId: 'original-grant', hasGrant: false },
    { grantId: 'original-grant', grantExpiresAt: new Date(1) },
    { grantId: 'original-grant', scopes: 'finance:read' },
  ]) {
    await assert.rejects(
      assertOAuthGrantActiveForFinancialWrite(fakeTx(options), context),
      (error: unknown) => error instanceof AppError && error.status === 401,
    );
  }
});

test('S02: current active grant with both write/read scopes is accepted', async () => {
  await assertOAuthGrantActiveForFinancialWrite(
    fakeTx({ grantId: 'original-grant' }),
    context,
  );
});
