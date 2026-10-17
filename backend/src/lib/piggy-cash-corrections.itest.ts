import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createApp } from '@/app';
import { AUTH_COOKIE_NAME, signAuthToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

test('piggy deposits appear as cash debits, while discarding a wrong balance never credits cash', async () => {
  const user = await prisma.user.create({
    data: { name: 'Piggy cash correction', email: `piggy-fix-${randomUUID()}@example.invalid`, passwordHash: 'test-only' },
  });
  const other = await prisma.user.create({
    data: { name: 'Another piggy owner', email: `piggy-other-${randomUUID()}@example.invalid`, passwordHash: 'test-only' },
  });
  const bank = await prisma.piggyBank.create({ data: { name: 'Porco', userId: user.id, monthlyGoal: 0 } });
  const app = createApp({ logRequests: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function send(userId: string, endpoint: string, method = 'GET', body?: Record<string, unknown>) {
    const result = await fetch(`${base}${endpoint}`, {
      method,
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${signAuthToken(userId, 0)}`,
        Origin: base,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: result.status, data: await result.json() as Record<string, unknown> };
  }
  try {
    const first = await send(user.id, `/piggy-banks/${bank.id}/deposit`, 'POST', { amount: 300 });
    assert.equal(first.status, 201);
    const second = await send(user.id, `/piggy-banks/${bank.id}/deposit`, 'POST', { amount: 150, deductFromBalance: false });
    assert.equal(second.status, 201);

    const noCredit = await send(user.id, `/piggy-banks/${bank.id}/withdraw`, 'POST', { amount: 150, creditToBalance: false });
    assert.equal(noCredit.status, 201);
    const noCreditTx = noCredit.data.transaction as { entryId: string | null; note: string | null };
    assert.equal(noCreditTx.entryId, null);
    assert.match(noCreditTx.note ?? '', /Correção de saldo incorreto/);

    const normal = await send(user.id, `/piggy-banks/${bank.id}/withdraw`, 'POST', { amount: 50 });
    assert.equal(normal.status, 201);
    assert.ok((normal.data.transaction as { entryId: string | null }).entryId);

    const movements = await send(user.id, '/piggy-banks/cash-movements');
    assert.equal(movements.status, 200);
    assert.deepEqual(
      (movements.data as unknown as Array<{ type: string; amount: number }>).map(({ type, amount }) => ({ type, amount })),
      [{ type: 'deposit', amount: 300 }, { type: 'withdraw', amount: 50 }],
    );
    const otherMovements = (await send(other.id, '/piggy-banks/cash-movements')).data as unknown as unknown[];
    assert.deepEqual(otherMovements, []);

    const invalid = await send(user.id, `/piggy-banks/${bank.id}/withdraw`, 'POST', { amount: 20, creditToBalance: 'yes' });
    assert.equal(invalid.status, 400);
    const overdraft = await send(user.id, `/piggy-banks/${bank.id}/withdraw`, 'POST', { amount: 9000, creditToBalance: false });
    assert.ok(overdraft.status >= 400);
    const foreign = await send(other.id, `/piggy-banks/${bank.id}/withdraw`, 'POST', { amount: 20, creditToBalance: false });
    assert.equal(foreign.status, 404);
    const txs = await prisma.piggyTransaction.findMany({ where: { userId: user.id } });
    assert.equal(txs.length, 4);
    assert.equal(await prisma.expense.count({ where: { userId: user.id, systemOrigin: 'piggy' } }), 1);
    assert.equal(await prisma.entry.count({ where: { userId: user.id, systemOrigin: 'piggy' } }), 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await prisma.piggyTransaction.deleteMany({ where: { userId: { in: [user.id, other.id] } } });
    await prisma.expense.deleteMany({ where: { userId: { in: [user.id, other.id] } } });
    await prisma.entry.deleteMany({ where: { userId: { in: [user.id, other.id] } } });
    await prisma.piggyBank.deleteMany({ where: { userId: { in: [user.id, other.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
  }
});
