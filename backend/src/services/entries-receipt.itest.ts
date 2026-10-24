import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createApp } from '@/app';
import { AppError } from '@/http/errors';
import { AUTH_COOKIE_NAME, signAuthToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

import { setReceiptState } from './entries';

function assertStatus(status: number) {
  return (error: unknown) =>
    error instanceof AppError && error.status === status;
}

test('historical one-off receipt is user-scoped, dated, idempotent and fenced against replay', async () => {
  const users = await Promise.all(
    [1, 2].map((index) =>
      prisma.user.create({
        data: {
          name: `Receipt test ${index}`,
          email: `receipt-${index}-${randomUUID()}@example.invalid`,
          passwordHash: 'test-only',
        },
      }),
    ),
  );

  try {
    const entry = await prisma.entry.create({
      data: {
        userId: users[0].id,
        name: 'Entrada histórica confirmada',
        amount: '700.00',
        frequency: 'unica',
        type: 'outro',
        // A planned date must not overwrite the separately confirmed cash date.
        date: new Date('2026-10-16T12:00:00.000Z'),
      },
    });
    const initialVersion = entry.updatedAt.toISOString();
    const request = {
      receivedOn: '2026-10-09',
      expectedUpdatedAt: initialVersion,
    };

    await assert.rejects(
      setReceiptState(users[1].id, entry.id, '2026-10', 'received', request),
      assertStatus(404),
    );

    const confirmed = await setReceiptState(
      users[0].id,
      entry.id,
      '2026-10',
      'received',
      request,
    );
    assert.equal(confirmed.receipts?.length, 1);
    const receipt = confirmed.receipts![0];
    assert.equal(receipt.month, '2026-10');
    assert.equal(Number(receipt.amount), 700);
    assert.equal(receipt.receivedAt.toISOString(), '2026-10-09T12:00:00.000Z');
    assert.equal(confirmed.name, entry.name);
    assert.equal(confirmed.date?.toISOString(), entry.date?.toISOString());
    assert.equal(Number(confirmed.amount), Number(entry.amount));
    assert.notEqual(confirmed.updatedAt.toISOString(), initialVersion);

    const retry = await setReceiptState(
      users[0].id,
      entry.id,
      '2026-10',
      'received',
      request,
    );
    assert.equal(retry.receipts?.[0]?.id, receipt.id);
    assert.equal(
      retry.updatedAt.toISOString(),
      confirmed.updatedAt.toISOString(),
    );
    await assert.rejects(
      setReceiptState(users[0].id, entry.id, '2026-10', 'received', {
        receivedOn: '2026-10-10',
        expectedUpdatedAt: initialVersion,
      }),
      assertStatus(409),
    );

    const undone = await setReceiptState(
      users[0].id,
      entry.id,
      '2026-10',
      'waiting',
      {
        expectedUpdatedAt: confirmed.updatedAt.toISOString(),
      },
    );
    assert.equal(undone.receipts?.length, 0);
    assert.notEqual(
      undone.updatedAt.toISOString(),
      confirmed.updatedAt.toISOString(),
    );
    await assert.rejects(
      setReceiptState(users[0].id, entry.id, '2026-10', 'received', request),
      assertStatus(409),
      'a replayed receive must not recreate a receipt after undo',
    );

    const version = undone.updatedAt.toISOString();
    const results = await Promise.allSettled([
      setReceiptState(users[0].id, entry.id, '2026-10', 'received', {
        receivedOn: '2026-10-09',
        expectedUpdatedAt: version,
      }),
      setReceiptState(users[0].id, entry.id, '2026-10', 'received', {
        receivedOn: '2026-10-10',
        expectedUpdatedAt: version,
      }),
    ]);
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === 'rejected').length,
      1,
    );
    assert.equal(
      await prisma.entryReceipt.count({ where: { entryId: entry.id } }),
      1,
    );
  } finally {
    await prisma.entryReceipt.deleteMany({
      where: { entry: { userId: { in: users.map((user) => user.id) } } },
    });
    await prisma.entry.deleteMany({
      where: { userId: { in: users.map((user) => user.id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map((user) => user.id) } },
    });
  }
});

test('authenticated API confirms historical cash once and isolates the other account', async () => {
  const users = await Promise.all(
    [1, 2].map((index) =>
      prisma.user.create({
        data: {
          name: `Receipt HTTP ${index}`,
          email: `receipt-http-${index}-${randomUUID()}@example.invalid`,
          passwordHash: 'test-only',
        },
      }),
    ),
  );
  let server: ReturnType<ReturnType<typeof createApp>['listen']> | undefined;
  try {
    const entry = await prisma.entry.create({
      data: {
        userId: users[0].id,
        name: 'Crédito já recebido',
        amount: '234.87',
        frequency: 'unica',
        type: 'outro',
        date: new Date('2026-10-16T12:00:00.000Z'),
      },
    });
    server = createApp({ logRequests: false }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = async (
      userId: string | null,
      path: string,
      method = 'GET',
      body?: unknown,
    ) => {
      const response = await fetch(`${origin}${path}`, {
        method,
        headers: {
          Origin: origin,
          ...(userId
            ? { Cookie: `${AUTH_COOKIE_NAME}=${signAuthToken(userId, 0)}` }
            : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: response.status,
        data: (await response.json()) as unknown,
      };
    };
    const endpoint = `/entries/${entry.id}/receipt-state`;
    const body = {
      month: '2026-10',
      state: 'received',
      receivedOn: '2026-10-09',
      expectedUpdatedAt: entry.updatedAt.toISOString(),
    };
    assert.equal((await request(null, endpoint, 'POST', body)).status, 401);
    assert.equal(
      (await request(users[1].id, endpoint, 'POST', body)).status,
      404,
    );
    assert.equal(
      (await request(users[0].id, endpoint, 'POST', body)).status,
      200,
    );
    assert.equal(
      (await request(users[0].id, endpoint, 'POST', body)).status,
      200,
    );
    assert.equal(
      await prisma.entryReceipt.count({ where: { entryId: entry.id } }),
      1,
    );

    const history = await request(users[0].id, '/financial-history');
    assert.equal(history.status, 200);
    const payload = history.data as {
      incomes: Array<{
        id: string;
        receipts: Array<{ amount: number; receivedAt: string }>;
      }>;
    };
    const confirmed = payload.incomes.find((income) => income.id === entry.id);
    assert.equal(confirmed?.receipts.length, 1);
    assert.equal(confirmed?.receipts[0]?.amount, 234.87);
    assert.equal(
      confirmed?.receipts[0]?.receivedAt,
      '2026-10-09T12:00:00.000Z',
    );
    const otherHistory = await request(users[1].id, '/financial-history');
    assert.equal(otherHistory.status, 200);
    assert.equal(
      (otherHistory.data as { incomes: Array<{ id: string }> }).incomes.some(
        (income) => income.id === entry.id,
      ),
      false,
    );
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await prisma.entryReceipt.deleteMany({
      where: { entry: { userId: { in: users.map((user) => user.id) } } },
    });
    await prisma.entry.deleteMany({
      where: { userId: { in: users.map((user) => user.id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map((user) => user.id) } },
    });
  }
});
