import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';

import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

import { resolveIncomeTagInTransaction } from './finance-tags';

async function createTestUser() {
  return prisma.user.create({
    data: {
      name: 'Income tag integration test',
      email: `income-tag-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only',
    },
  });
}

test('reuses existing tags across casing, canonical Unicode and compatibility equivalents', async () => {
  const user = await createTestUser();
  try {
    const existing = await prisma.customTag.create({
      data: { userId: user.id, scope: 'income', name: 'Présente', color: '#F472B6' },
    });

    for (const equivalent of ['PRÉSENTE', 'Pre\u0301sente', 'ＰＲÉＳＥＮＴＥ']) {
      const resolved = await withUserWriteLockTransaction(user.id, (tx) =>
        resolveIncomeTagInTransaction(tx, user.id, equivalent),
      );
      assert.deepEqual(resolved, { id: existing.id, created: false });
    }

    assert.equal(await prisma.customTag.count({ where: { userId: user.id } }), 1);
    assert.equal(
      (await prisma.customTag.findUniqueOrThrow({ where: { id: existing.id } })).color,
      '#F472B6',
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('creates trimmed income tags, with user and scope isolation', async () => {
  const [userA, userB] = await Promise.all([createTestUser(), createTestUser()]);
  try {
    const expense = await prisma.customTag.create({
      data: { userId: userA.id, scope: 'expense', name: 'Presente', color: '#000000' },
    });
    const first = await withUserWriteLockTransaction(userA.id, (tx) =>
      resolveIncomeTagInTransaction(tx, userA.id, '  Presente  '),
    );
    const second = await withUserWriteLockTransaction(userB.id, (tx) =>
      resolveIncomeTagInTransaction(tx, userB.id, 'presente'),
    );
    assert.equal(first.created, true);
    assert.equal(second.created, true);
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.id, expense.id);
    const tag = await prisma.customTag.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(tag.name, 'Presente');
    assert.equal(tag.scope, 'income');
    assert.equal(tag.userId, userA.id);
    assert.equal(tag.color, '#34D399');
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  }
});

test('concurrent transactions cannot create equivalent income tags', async () => {
  const user = await createTestUser();
  try {
    const results = await Promise.all(
      ['Presente', 'presente', 'ＰＲＥＳＥＮＴＥ', 'PRESENTE'].map((name) =>
        prisma.$transaction((tx) => resolveIncomeTagInTransaction(tx, user.id, name)),
      ),
    );
    assert.equal(new Set(results.map((result) => result.id)).size, 1);
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(
      await prisma.customTag.count({ where: { userId: user.id, scope: 'income' } }),
      1,
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('the database rejects Unicode casefold duplicates even when bypassing the resolver', async () => {
  const user = await createTestUser();
  try {
    const first = await prisma.customTag.create({
      data: { userId: user.id, scope: 'income', name: 'Straße', color: '#334455' },
    });
    await assert.rejects(
      prisma.customTag.create({
        data: { userId: user.id, scope: 'income', name: 'STRASSE', color: '#334455' },
      }),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'P2002',
    );
    assert.deepEqual(
      await prisma.customTag.findMany({ where: { userId: user.id }, select: { id: true } }),
      [{ id: first.id }],
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('rejects blank and oversized tag names and rolls back with the caller transaction', async () => {
  const user = await createTestUser();
  try {
    await assert.rejects(
      withUserWriteLockTransaction(user.id, (tx) =>
        resolveIncomeTagInTransaction(tx, user.id, '\u00a0 \t'),
      ),
      /nome|tag|tipo/i,
    );
    await assert.rejects(
      withUserWriteLockTransaction(user.id, (tx) =>
        resolveIncomeTagInTransaction(tx, user.id, 'a'.repeat(101)),
      ),
      /nome|tag|tipo/i,
    );
    await assert.rejects(
      withUserWriteLockTransaction(user.id, async (tx) => {
        await resolveIncomeTagInTransaction(tx, user.id, 'Rollback');
        throw new Error('later accounting step failed');
      }),
      /later accounting step failed/,
    );
    assert.equal(await prisma.customTag.count({ where: { userId: user.id } }), 0);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('migration preflight rejects existing case/Unicode collisions without mutating tags', async () => {
  const migration = await readFile(
    path.resolve(process.cwd(), 'prisma/migrations/20261016194000_income_tag_casefold_unique/migration.sql'),
    'utf8',
  );
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    for (const [first, second] of [
      ['Presente', 'presente'],
      ['Présente', 'Pre\u0301sente'],
    ]) {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL search_path = pg_temp, public');
        await client.query(`
          CREATE TEMP TABLE "CustomTag" (
            "id" text PRIMARY KEY, "userId" text NOT NULL,
            "scope" public."CustomTagScope" NOT NULL, "name" text NOT NULL
          ) ON COMMIT DROP
        `);
        const owner = randomUUID();
        const ids = [randomUUID(), randomUUID()];
        await client.query(
          `INSERT INTO "CustomTag" ("id", "userId", "scope", "name")
           VALUES ($1, $3, 'income', $4), ($2, $3, 'income', $5)`,
          [...ids, owner, first, second],
        );
        await client.query('SAVEPOINT before_migration');
        await assert.rejects(
          client.query(migration),
          (error: unknown) =>
            error instanceof Error &&
            /collision|duplicad/i.test(error.message) &&
            error.message.includes(owner) &&
            ids.every((id) => error.message.includes(id)),
        );
        await client.query('ROLLBACK TO SAVEPOINT before_migration');
        assert.equal((await client.query('SELECT count(*)::int AS n FROM "CustomTag"')).rows[0].n, 2);
      } finally {
        await client.query('ROLLBACK');
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
});
