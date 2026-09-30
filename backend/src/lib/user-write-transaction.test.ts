import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

test('serializes concurrent write transactions for one user', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Transaction test',
      email: `write-lock-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });

  let activeWriters = 0;
  let maximumActiveWriters = 0;
  try {
    await Promise.all(
      Array.from({ length: 2 }, () =>
        withUserWriteLockTransaction(user.id, async () => {
          activeWriters += 1;
          maximumActiveWriters = Math.max(maximumActiveWriters, activeWriters);
          await new Promise((resolve) => setTimeout(resolve, 20));
          activeWriters -= 1;
        }),
      ),
    );

    assert.equal(maximumActiveWriters, 1);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
});
