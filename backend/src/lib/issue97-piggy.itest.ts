import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createApp } from '@/app';
import { AUTH_COOKIE_NAME, signAuthToken } from '@/lib/auth';
import { processPiggyAutoDebits } from '@/lib/piggy';
import { computeMonthlyGoal } from '@/lib/piggy/model';
import { catchUpPiggyInterest } from '@/lib/piggy-interest';
import { prisma } from '@/lib/prisma';
import {
  createPiggyBank,
  depositToBank,
  listPiggyCashMovements,
  withdrawFromBank,
} from '@/services/piggy-banks';

async function withUser(run: (userId: string) => Promise<void>) {
  const user = await prisma.user.create({
    data: {
      name: 'Issue 97 piggy regression',
      email: `issue97-piggy-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only-not-a-login-hash',
    },
  });
  try {
    await run(user.id);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
}

test('A06: CDI reaching the target completes once and stops future auto-debits', async () => {
  await withUser(async (userId) => {
    const bank = await prisma.piggyBank.create({
      data: {
        userId,
        name: 'CDI goal',
        goalAmount: '10000.05',
        monthlyGoal: 100,
        autoDebit: true,
        autoDebitDay: 28,
        autoDebitEnabledAt: new Date('2026-09-14T12:00:00.000Z'),
        yieldEnabled: true,
        cdiPercent: 100,
        interestAccruedThrough: new Date('2026-09-14T12:00:00.000Z'),
        createdAt: new Date('2026-09-14T12:00:00.000Z'),
      },
    });
    await prisma.piggyTransaction.create({
      data: {
        piggyBankId: bank.id,
        userId,
        type: 'deposit',
        source: 'manual',
        amount: 10000,
        date: new Date('2026-09-14T12:00:00.000Z'),
      },
    });

    const options = {
      now: new Date('2026-09-16T16:00:00.000Z'),
      fetchHistory: async () => ({
        provider: 'test',
        stale: false,
        points: [{ date: '2026-09-15', value: '0.1' }],
      }),
    };
    assert.equal((await catchUpPiggyInterest(userId, options)).createdCount, 1);
    const saved = await prisma.piggyBank.findUniqueOrThrow({ where: { id: bank.id } });
    assert.equal(saved.completedAt?.toISOString(), '2026-09-15T12:00:00.000Z');
    assert.equal((await catchUpPiggyInterest(userId, options)).createdCount, 0);
    assert.equal((await processPiggyAutoDebits(userId, new Date('2026-09-30T16:00:00.000Z'))).createdCount, 0);
    assert.equal(await prisma.piggyTransaction.count({ where: { piggyBankId: bank.id, type: 'interest' } }), 1);
    assert.equal(await prisma.piggyTransaction.count({ where: { piggyBankId: bank.id, source: 'auto_debit' } }), 0);
  });
});

test('A08: funds stay visible and withdrawable until an empty completed bank is archived', async () => {
  await withUser(async (userId) => {
    const bank = await prisma.piggyBank.create({
      data: { userId, name: 'Reserve', goalAmount: 100, monthlyGoal: 100 },
    });
    const server = createApp({ logRequests: false }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = async (path: string, method = 'GET', body?: object) => {
      const response = await fetch(`${origin}/piggy-banks${path}`, {
        method,
        headers: {
          Cookie: `${AUTH_COOKIE_NAME}=${signAuthToken(userId, 0)}`,
          Origin: origin,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json() as unknown };
    };
    try {
      assert.equal((await request(`/${bank.id}/deposit`, 'POST', { amount: 100 })).status, 201);
      const active = await request('');
      assert.equal((active.data as Array<{ balance: number }>)[0].balance, 100);
      assert.equal((await request(`/${bank.id}/archive`, 'POST')).status, 409);
      assert.equal(((await request('')).data as Array<unknown>).length, 1);

      const withdrawal = await request(`/${bank.id}/withdraw`, 'POST', { amount: 100 });
      assert.equal(withdrawal.status, 201);
      assert.equal((withdrawal.data as { transaction: { amount: number } }).transaction.amount, 100);
      assert.equal((await listPiggyCashMovements(userId)).length, 2);
      assert.equal((await request(`/${bank.id}/archive`, 'POST')).status, 200);
      assert.equal(((await request('')).data as Array<unknown>).length, 0);
      assert.equal(((await request('?includeArchived=true')).data as Array<{ id: string }>).length, 1);
      assert.equal(await prisma.piggyTransaction.count({ where: { piggyBankId: bank.id } }), 2);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

test('B01: persisted monthly amount tracks deposits and withdrawals without losing cents', async () => {
  await withUser(async (userId) => {
    const targetDate = new Date('2028-12-31T12:00:00.000Z');
    const bank = await createPiggyBank(userId, {
      name: 'Targeted savings',
      goalAmount: 1200,
      targetDate,
      autoDebit: false,
      monthlyGoal: null,
      autoDebitDay: 1,
      isEmergency: false,
      yieldEnabled: false,
      cdiPercent: 0,
    });
    const initialMonthly = Number(bank.monthlyGoal);
    assert.equal(initialMonthly, computeMonthlyGoal(1200, targetDate));
    await depositToBank(userId, bank.id, { amount: 300.01, note: null });
    const afterDeposit = Number((await prisma.piggyBank.findUniqueOrThrow({ where: { id: bank.id } })).monthlyGoal);
    assert.equal(afterDeposit, computeMonthlyGoal(1200, targetDate, new Date(), 300.01));
    assert.ok(afterDeposit < initialMonthly);
    await withdrawFromBank(userId, bank.id, { amount: 100.02, note: null });
    const afterWithdrawal = Number((await prisma.piggyBank.findUniqueOrThrow({ where: { id: bank.id } })).monthlyGoal);
    assert.equal(afterWithdrawal, computeMonthlyGoal(1200, targetDate, new Date(), 199.99));
    assert.ok(afterWithdrawal > afterDeposit);
  });
});
