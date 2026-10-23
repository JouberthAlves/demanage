import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createApp } from '@/app';
import { AUTH_COOKIE_NAME, signAuthToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/** Run against an explicitly disposable PostgreSQL test database. */
test('historical endpoint keeps archived cash but isolates users and ordinary CRUD lists', async () => {
  const users: string[] = [];
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    for (const name of ['history-owner', 'history-other']) {
      const user = await prisma.user.create({
        data: {
          name,
          email: `${name}-${randomUUID()}@example.invalid`,
          passwordHash: 'test-only-not-a-login-hash',
        },
      });
      users.push(user.id);
    }
    const [owner, other] = users;
    assert.ok(owner && other);
    const old = new Date('2026-10-20T12:00:00Z');

    for (const userId of users) {
      const expense = await prisma.expense.create({
        data: {
          userId,
          name: 'Archived paid expense',
          amount: 999,
          category: 'outro',
          frequency: 'mensal',
          archivedAt: old,
        },
      });
      await prisma.expensePayment.create({
        data: {
          expenseId: expense.id,
          month: '2026-09',
          amount: 42,
          paidAt: new Date('2026-09-10T12:00:00Z'),
        },
      });
      const entry = await prisma.entry.create({
        data: {
          userId,
          name: 'Archived received income',
          amount: 888,
          type: 'outro',
          frequency: 'mensal',
          archivedAt: old,
        },
      });
      await prisma.entryReceipt.create({
        data: {
          entryId: entry.id,
          month: '2026-09',
          amount: 55,
          receivedAt: new Date('2026-09-12T12:00:00Z'),
        },
      });
    }

    // Internal cash rows belong to the asset/piggy sources, not this endpoint.
    await prisma.expense.create({
      data: {
        userId: owner,
        name: 'Internal asset expense',
        amount: 100,
        category: 'investimento',
        frequency: 'unica',
        systemOrigin: 'asset',
      },
    });
    server = createApp({ logRequests: false }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const request = async (path: string, cookie?: string) => {
      const response = await fetch(`${origin}${path}`, {
        headers: cookie ? { Cookie: cookie } : {},
      });
      return {
        status: response.status,
        data: (await response.json()) as unknown,
      };
    };

    assert.equal((await request('/financial-history')).status, 401);
    const cookie = `${AUTH_COOKIE_NAME}=${signAuthToken(owner, 0)}`;
    const archived = await request('/financial-history', cookie);
    assert.equal(archived.status, 200);
    const result = archived.data as {
      expenses: Array<{
        id: string;
        userId: string;
        archivedAt: string;
        payments: Array<{ amount: number }>;
      }>;
      incomes: Array<{
        id: string;
        userId: string;
        archivedAt: string;
        receipts: Array<{ amount: number }>;
      }>;
    };
    assert.equal(result.expenses.length, 1);
    assert.equal(result.incomes.length, 1);
    assert.equal(result.expenses[0]?.userId, owner);
    assert.equal(result.incomes[0]?.userId, owner);
    assert.equal(result.expenses[0]?.payments[0]?.amount, 42);
    assert.equal(result.incomes[0]?.receipts[0]?.amount, 55);
    assert.ok(result.expenses[0]?.archivedAt);
    assert.ok(result.incomes[0]?.archivedAt);

    const ordinaryExpenses = await request('/expenses', cookie);
    const ordinaryIncomes = await request('/entries', cookie);
    assert.deepEqual(ordinaryExpenses.data, []);
    assert.deepEqual(ordinaryIncomes.data, []);
  } finally {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    for (const userId of users) {
      const expenses = await prisma.expense.findMany({
        where: { userId },
        select: { id: true },
      });
      const entries = await prisma.entry.findMany({
        where: { userId },
        select: { id: true },
      });
      await prisma.expensePayment.deleteMany({
        where: { expenseId: { in: expenses.map((item) => item.id) } },
      });
      await prisma.entryReceipt.deleteMany({
        where: { entryId: { in: entries.map((item) => item.id) } },
      });
      await prisma.expense.deleteMany({ where: { userId } });
      await prisma.entry.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } });
    }
  }
});
