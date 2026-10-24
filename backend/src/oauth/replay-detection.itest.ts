import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';

import { OAuthPrismaAdapter } from './adapter';

import '@/test-support/db-env';

test('S05 PostgreSQL: concurrent private_key_jwt JTI reservations are durable and one-time', { timeout: 30_000 }, async () => {
  const issuer = 'https://chatgpt.com/oauth/client.json';
  const jti = `s05-db-race-${randomUUID()}`;
  // oidc-provider derives ReplayDetection.id from issuer and assertion JTI.
  const id = createHash('sha256').update(`${issuer}${jti}`).digest('base64url');
  const otherId = createHash('sha256').update(`${issuer}${jti}-different`).digest('base64url');
  const claimantCount = 12;
  const claimants = Array.from({ length: claimantCount }, () => new OAuthPrismaAdapter('ReplayDetection'));

  try {
    // Every simulated request reads an unused JTI before any one can insert.
    // This deliberately reproduces the find -> save TOCTOU across connections.
    const initialReads = await Promise.all(claimants.map((adapter) => adapter.find(id)));
    assert.ok(initialReads.every((payload) => payload === undefined));

    const results = await Promise.allSettled(claimants.map((adapter, index) =>
      adapter.upsert(id, { iss: issuer, jti, requestId: `claim-${index}` }, 120)));
    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    assert.equal(successes.length, 1, 'only one PostgreSQL INSERT may claim a JTI');
    assert.equal(failures.length, claimantCount - 1);
    for (const failure of failures) {
      if (failure.status !== 'rejected') continue;
      assert.equal(failure.reason.error, 'invalid_client');
      assert.equal(failure.reason.statusCode, 401);
    }

    const persisted = await prisma.oAuthArtifact.findUniqueOrThrow({
      where: { model_id: { model: 'ReplayDetection', id } },
    });
    const winnerPayload = persisted.payload;
    assert.equal(persisted.model, 'ReplayDetection');
    assert.equal(await prisma.oAuthArtifact.count({ where: { model: 'ReplayDetection', id } }), 1);

    // A newly constructed adapter stands in for a restarted HTTP process.
    await assert.rejects(
      new OAuthPrismaAdapter('ReplayDetection').upsert(id, { iss: issuer, jti, requestId: 'replayed-after-restart' }, 120),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'error' in error && error.error === 'invalid_client'),
    );
    const preserved = await prisma.oAuthArtifact.findUniqueOrThrow({
      where: { model_id: { model: 'ReplayDetection', id } },
    });
    assert.deepEqual(preserved.payload, winnerPayload, 'replayed assertions cannot overwrite the first claim');

    // Only the identical JTI is denied; a different assertion remains usable.
    await new OAuthPrismaAdapter('ReplayDetection').upsert(otherId, { iss: issuer, jti: `${jti}-different` }, 120);
  } finally {
    await prisma.oAuthArtifact.deleteMany({ where: { model: 'ReplayDetection', id: { in: [id, otherId] } } });
  }
});
