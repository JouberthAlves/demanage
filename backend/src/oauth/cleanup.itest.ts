import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';

import { pruneExpiredOAuthArtifacts } from './cleanup';

test('expired OAuth artifacts are pruned in bounded batches, never active grants', async () => {
  const model = `OAuthCleanup-${randomUUID()}`;
  const old = new Date('1998-01-01T00:00:00Z');
  const newer = new Date('1998-06-01T00:00:00Z');
  const cutoff = new Date('1999-01-01T00:00:00Z');
  try {
    await prisma.oAuthArtifact.createMany({
      data: [
        { model, id: 'expired-old', payload: { audit: 'old' }, expiresAt: old },
        { model, id: 'expired-new', payload: { audit: 'new' }, expiresAt: newer },
        { model, id: 'active', payload: { audit: 'keep' }, expiresAt: new Date('2100-01-01T00:00:00Z') },
        { model, id: 'no-expiry', payload: { audit: 'keep' }, expiresAt: null },
      ],
    });
    assert.equal(await pruneExpiredOAuthArtifacts(cutoff, 1), 1);
    assert.deepEqual(
      (await prisma.oAuthArtifact.findMany({ where: { model }, select: { id: true }, orderBy: { id: 'asc' } })).map(({ id }) => id),
      ['active', 'expired-new', 'no-expiry'],
    );
    assert.equal(await pruneExpiredOAuthArtifacts(cutoff, 1), 1);
    assert.equal(await pruneExpiredOAuthArtifacts(cutoff, 100), 0);
    assert.deepEqual(
      (await prisma.oAuthArtifact.findMany({ where: { model }, select: { id: true }, orderBy: { id: 'asc' } })).map(({ id }) => id),
      ['active', 'no-expiry'],
    );
    await assert.rejects(() => pruneExpiredOAuthArtifacts(cutoff, 0));
    await assert.rejects(() => pruneExpiredOAuthArtifacts(cutoff, 50_000));
  } finally {
    await prisma.oAuthArtifact.deleteMany({ where: { model } });
  }
});
