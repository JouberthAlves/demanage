import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';

import { OAuthPrismaAdapter } from './adapter';

import '@/test-support/db-env';

type Artifact = {
  model: string;
  id: string;
  payload: { iss: string; jti: string };
  expiresAt: Date | null;
};

test('S05: two exchanges that observed the same signed assertion JTI cannot both reserve it', async () => {
  const issuer = 'https://chatgpt.com/oauth/client.json';
  const jti = 'two-simultaneous-valid-signed-assertions';
  // oidc-provider hashes `${iss}${jti}` before accessing ReplayDetection.
  const id = createHash('sha256').update(`${issuer}${jti}`).digest('base64url');
  const rows = new Map<string, Artifact>();
  const keyFor = (model: string, value: string) => `${model}:${value}`;
  let reads = 0;
  let releaseReaders!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    releaseReaders = resolve;
  });
  let updates = 0;

  // Deterministic stand-in for two independent PostgreSQL connections:
  // both requests complete ReplayDetection.find before either writes.
  // The unique (model,id) constraint decides who owns the claim.
  const repository = {
    async findUnique(args: {
      where: { model_id: { model: string; id: string } };
    }) {
      const { model, id: rowId } = args.where.model_id;
      const snapshot = rows.get(keyFor(model, rowId)) ?? null;
      reads += 1;
      if (reads === 2) releaseReaders();
      await bothRead;
      return snapshot;
    },
    async upsert(args: {
      where: { model_id: { model: string; id: string } };
      create: Artifact;
      update: Pick<Artifact, 'payload' | 'expiresAt'>;
    }) {
      const { model, id: rowId } = args.where.model_id;
      const key = keyFor(model, rowId);
      const existing = rows.get(key);
      if (existing) updates += 1;
      const row = existing ? { ...existing, ...args.update } : args.create;
      rows.set(key, row);
      return row;
    },
    async create(args: { data: Artifact }) {
      const key = keyFor(args.data.model, args.data.id);
      if (rows.has(key)) {
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        });
      }
      rows.set(key, args.data);
      return args.data;
    },
  } as unknown as typeof prisma.oAuthArtifact;

  const first = new OAuthPrismaAdapter('ReplayDetection', repository);
  const second = new OAuthPrismaAdapter('ReplayDetection', repository);
  const attempt = async (adapter: OAuthPrismaAdapter) => {
    assert.equal(await adapter.find(id), undefined);
    await adapter.upsert(id, { iss: issuer, jti: id }, 120);
  };
  const results = await Promise.allSettled([attempt(first), attempt(second)]);

  assert.equal(reads, 2, 'both concurrent requests saw an unused assertion');
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.equal(rejected.reason.error, 'invalid_client');
  assert.equal(rejected.reason.statusCode, 401);
  assert.equal(rows.size, 1);
  assert.equal(updates, 0, 'replay must never update a previous claim');
});

test('S05: non-duplicate ReplayDetection storage errors fail closed', async () => {
  const store = {
    create: async () => {
      throw new Error('storage unavailable');
    },
  } as unknown as typeof prisma.oAuthArtifact;
  await assert.rejects(
    new OAuthPrismaAdapter('ReplayDetection', store).upsert(
      'some-claim',
      { jti: 'claim' },
      60,
    ),
    /storage unavailable/,
  );
});

test('S05: other OAuth artifacts retain update-on-conflict semantics', async () => {
  const writes: string[] = [];
  const store = {
    upsert: async () => {
      writes.push('upsert');
    },
    create: async () => {
      writes.push('create');
    },
  } as unknown as typeof prisma.oAuthArtifact;

  await new OAuthPrismaAdapter('AuthorizationCode', store).upsert(
    'code-id',
    {
      clientId: 'client-id',
    },
    120,
  );
  assert.deepEqual(writes, ['upsert']);
});
