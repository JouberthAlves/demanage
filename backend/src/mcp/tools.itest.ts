import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';

import { todayKeyInSaoPaulo } from '@/lib/civil-date';
import { prisma } from '@/lib/prisma';

import { createMcpHttpRouter } from './http';
import { readPiggyBankPage } from './tools';

function readRpc(text: string): { result?: { content?: Array<{ text: string }>; isError?: boolean } } {
  const payload = text.startsWith('event:')
    ? text.split(/\r?\n/).find((line) => line.startsWith('data: '))?.slice(6)
    : text;
  assert.ok(payload, 'MCP must return a JSON-RPC result');
  return JSON.parse(payload);
}

test('MCP client previews, executes once and queries its own committed income+piggy gift', async () => {
  process.env.MCP_INTENT_SECRET = 'integration-only-financial-intent-signing-key-long';
  const user = await prisma.user.create({
    data: { name: 'MCP end-to-end test', email: `mcp-e2e-${randomUUID()}@example.invalid`, passwordHash: 'test-only' },
  });
  const bank = await prisma.piggyBank.create({ data: { userId: user.id, name: 'Porco', monthlyGoal: 0 } });
  const app = express();
  app.use(createMcpHttpRouter({
    resourceUrl: 'http://127.0.0.1/api/mcp', issuerUrl: 'http://127.0.0.1/api/oauth', isProduction: false,
    verifyBearer: async (token) => token === 'owner-reader-writer'
      ? { userId: user.id, clientId: 'mcp-e2e', scopes: new Set(['finance:read', 'finance:write']) }
      : token === 'foreign-reader-writer'
        ? { userId: 'other-user', clientId: 'other-mcp', scopes: new Set(['finance:read', 'finance:write']) }
        : null,
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  async function call(name: string, args: Record<string, unknown>, token = 'owner-reader-writer') {
    const http = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: { name, arguments: args } }),
    });
    assert.equal(http.status, 200);
    const rpc = readRpc(await http.text());
    assert.ok(rpc.result?.content?.[0]?.text);
    const text = rpc.result.content[0].text;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      assert.equal(rpc.result.isError, true, 'A tool may return plain text only on failure');
      data = { error: text };
    }
    return { isError: rpc.result.isError === true, data };
  }

  try {
    const preview = await call('preview_financial_operation', {
      draft: {
        kind: 'receive_and_save', amountCents: 2_000, dateKey: todayKeyInSaoPaulo(),
        description: 'Presente da minha vó', tagName: 'Presente', bankName: 'Porco',
      },
    });
    assert.equal(preview.isError, false);
    assert.equal(preview.data.status, 'ready');
    assert.deepEqual(preview.data.effects, { cashDeltaCents: 0, piggyDeltaCents: 2_000 });
    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 0);
    const key = randomUUID();
    const committed = await call('execute_financial_operation', {
      intentToken: preview.data.intentToken, idempotencyKey: key,
    });
    assert.equal(committed.isError, false);
    assert.equal(committed.data.status, 'committed');
    assert.equal(committed.data.replayed, false);

    const repeated = await call('execute_financial_operation', {
      intentToken: preview.data.intentToken, idempotencyKey: key,
    });
    assert.equal(repeated.isError, false);
    assert.equal(repeated.data.status, 'committed');
    assert.equal(repeated.data.replayed, true);

    const foreign = await call('execute_financial_operation', {
      intentToken: preview.data.intentToken, idempotencyKey: randomUUID(),
    }, 'foreign-reader-writer');
    assert.equal(foreign.isError, true);
    const status = await call('get_operation_status', { idempotencyKey: key });
    assert.equal(status.data.status, 'committed');

    assert.equal(await prisma.entry.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.entryReceipt.count({ where: { entry: { userId: user.id } } }), 1);
    assert.equal(await prisma.customTag.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.piggyTransaction.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.expense.count({ where: { userId: user.id } }), 1);
    assert.equal(await prisma.financeMcpOperation.count({ where: { userId: user.id } }), 1);
    const gift = await prisma.piggyTransaction.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(gift.piggyBankId, bank.id);
    assert.equal(Number(gift.amount), 20);

    const listed = await call('list_piggy_banks', {});
    assert.equal(listed.isError, false);
    assert.deepEqual(listed.data, { banks: [{
      id: bank.id, name: 'Porco', balanceBrl: '20.00', goalBrl: null, completed: false,
    }], nextCursor: null }, 'MCP response exposes stable paginated shape and exact computed balance');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.financeMcpOperation.deleteMany({ where: { userId: user.id } });
    await prisma.entryReceipt.deleteMany({ where: { entry: { userId: user.id } } });
    await prisma.piggyTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.expense.deleteMany({ where: { userId: user.id } });
    await prisma.entry.deleteMany({ where: { userId: user.id } });
    await prisma.customTag.deleteMany({ where: { userId: user.id } });
    await prisma.piggyBank.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('MCP piggy pages are stable and DB sums exactly match large signed ledgers', async () => {
  const user = await prisma.user.create({
    data: { name: 'Piggy aggregation stress', email: `mcp-piggy-${randomUUID()}@example.invalid`, passwordHash: 'test-only' },
  });
  try {
    const banks = Array.from({ length: 113 }, (_, i) => ({
      id: randomUUID(), userId: user.id, name: `Bank ${i}`,
      monthlyGoal: 0, createdAt: new Date('2026-10-01T00:00:00.000Z'),
    }));
    await prisma.piggyBank.createMany({ data: banks });
    const transactions = banks.flatMap((bank) => [
      { userId: user.id, piggyBankId: bank.id, type: 'deposit' as const, amount: 0.10, date: new Date('2026-10-03T12:00:00Z') },
      { userId: user.id, piggyBankId: bank.id, type: 'interest' as const, amount: 0.20, date: new Date('2026-10-04T12:00:00Z') },
      { userId: user.id, piggyBankId: bank.id, type: 'withdraw' as const, amount: 0.05, date: new Date('2026-10-05T12:00:00Z') },
    ]);
    await prisma.piggyTransaction.createMany({ data: transactions });
    const seen = new Map<string, string>();
    let cursor: string | undefined;
    const pageSizes: number[] = [];
    do {
      const page = await readPiggyBankPage(user.id, 50, cursor);
      pageSizes.push(page.banks.length);
      for (const bank of page.banks) {
        assert.equal(seen.has(bank.id), false, 'stable cursor must not repeat records');
        seen.set(bank.id, bank.balanceBrl);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    assert.deepEqual(pageSizes, [50, 50, 13]);
    assert.equal(seen.size, 113);
    for (const bank of banks) assert.equal(seen.get(bank.id), '0.25');

    const extra = await prisma.piggyTransaction.createMany({ data: Array.from({ length: 420 }, () => ({
      userId: user.id, piggyBankId: banks[0]!.id, type: 'deposit' as const,
      amount: 0.01, date: new Date('2026-10-05T12:00:00Z'),
    })) });
    assert.equal(extra.count, 420);
    const first = await readPiggyBankPage(user.id, 100);
    const next = await readPiggyBankPage(user.id, 100, first.nextCursor!);
    assert.equal(first.banks.length + next.banks.length, 113);
    const recomputed = [...first.banks, ...next.banks].find(({ id }) => id === banks[0]!.id);
    assert.equal(recomputed?.balanceBrl, '4.45');
    const legacyId = `ck${randomUUID().replace(/-/g, '')}`;
    await prisma.piggyBank.create({ data: {
      id: legacyId, userId: user.id, name: 'Legacy CUID ID', monthlyGoal: 0,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
    } });
    const legacyFirst = await readPiggyBankPage(user.id, 1);
    assert.equal(legacyFirst.nextCursor, legacyId);
    const afterLegacy = await readPiggyBankPage(user.id, 1, legacyId);
    assert.equal(afterLegacy.banks.length, 1, 'legacy ID must also work as a cursor');
    await assert.rejects(readPiggyBankPage(user.id, 50, randomUUID()), /Cursor/);
  } finally {
    await prisma.piggyTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.piggyBank.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
