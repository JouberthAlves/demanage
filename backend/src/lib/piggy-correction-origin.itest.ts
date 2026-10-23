import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';
import {
  depositToBank,
  listPiggyCashMovements,
  withdrawFromBank,
} from '@/services/piggy-banks';

async function fixture() {
  const user = await prisma.user.create({
    data: { name: 'Correction origin test', email: 'origin-' + randomUUID() + '@example.invalid', passwordHash: 'test-only' },
  });
  const bank = await prisma.piggyBank.create({
    data: { name: 'Porco', userId: user.id, monthlyGoal: 0 },
  });
  return {
    user, bank,
    async cleanup() {
      await prisma.piggyTransaction.deleteMany({ where: { userId: user.id } });
      await prisma.entry.deleteMany({ where: { userId: user.id } });
      await prisma.expense.deleteMany({ where: { userId: user.id } });
      await prisma.piggyBank.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    },
  };
}

function correction(amount: number, origin: 'debited' | 'not_debited') {
  return {
    amount,
    note: null,
    correctionOrigin: origin,
    creditToBalance: false as const,
  };
}

test('debited correction nets its own linked expense without unrelated income or duplicate credit', async () => {
  const f = await fixture();
  try {
    await depositToBank(f.user.id, f.bank.id, { amount: 450, note: null });
    const a = await withdrawFromBank(f.user.id, f.bank.id, correction(200, 'debited'));
    const b = await withdrawFromBank(f.user.id, f.bank.id, correction(250, 'debited'));
    assert.match(a.transaction.note ?? '', /^Correção de saldo incorreto.*\[origem:debited\]/);
    assert.ok(a.transaction.entryId);
    assert.ok(b.transaction.entryId);
    assert.equal(a.transaction.correctionOrigin, 'debited');
    assert.equal(b.transaction.correctionOrigin, 'debited');
    await assert.rejects(() => prisma.piggyTransaction.update({
      where: { id: a.transaction.id },
      data: { correctionOrigin: 'not_debited' },
    }), 'the database must reject mutation of recorded correction provenance');
    assert.equal((await prisma.entry.count({ where: { userId: f.user.id } })), 2);
    assert.equal((await prisma.expense.count({ where: { userId: f.user.id } })), 1);
    const movements = await listPiggyCashMovements(f.user.id);
    assert.deepEqual(movements.map((row) => [row.type, row.amount]), [
      ['deposit', 450], ['withdraw', 200], ['withdraw', 250],
    ]);
    assert.equal(movements.reduce((sum, row) =>
      sum + (row.type === 'deposit' ? -row.amount : row.amount), 0), 0);
    assert.equal(Number((await prisma.piggyBank.findUniqueOrThrow({
      where: { id: f.bank.id }, include: { transactions: true },
    })).transactions.reduce((sum, row) => sum + (row.type === 'withdraw' ? -Number(row.amount) : Number(row.amount)), 0)), 0);
    await assert.rejects(() => withdrawFromBank(f.user.id, f.bank.id, correction(1, 'debited')));
  } finally {
    await f.cleanup();
  }
});

test('not-debited correction makes no income and cannot switch to a debited source', async () => {
  const f = await fixture();
  try {
    await depositToBank(f.user.id, f.bank.id, { amount: 150, note: null, deductFromBalance: false });
    await assert.rejects(() => withdrawFromBank(f.user.id, f.bank.id, correction(150, 'debited')), (error: unknown) =>
      typeof error === 'object' && error !== null && 'status' in error && error.status === 409);
    const result = await withdrawFromBank(f.user.id, f.bank.id, correction(150, 'not_debited'));
    assert.equal(result.transaction.entryId, null);
    assert.equal(result.transaction.correctionOrigin, 'not_debited');
    assert.match(result.transaction.note ?? '', /^Correção de saldo incorreto.*\[origem:not_debited\]/);
    assert.equal(await prisma.entry.count({ where: { userId: f.user.id } }), 0);
    assert.deepEqual(await listPiggyCashMovements(f.user.id), []);
  } finally {
    await f.cleanup();
  }
});

test('mixed untouched deposits are corrected by origin without inventing double cash credit', async () => {
  const f = await fixture();
  try {
    await depositToBank(f.user.id, f.bank.id, { amount: 300, note: null });
    await depositToBank(f.user.id, f.bank.id, { amount: 150, note: null, deductFromBalance: false });
    const noCash = await withdrawFromBank(f.user.id, f.bank.id, correction(150, 'not_debited'));
    assert.equal(noCash.transaction.entryId, null);
    const compensate = await withdrawFromBank(f.user.id, f.bank.id, correction(300, 'debited'));
    assert.ok(compensate.transaction.entryId);
    assert.deepEqual((await listPiggyCashMovements(f.user.id)).map((row) => [row.type, row.amount]), [
      ['deposit', 300], ['withdraw', 300],
    ]);
    assert.equal(await prisma.entry.count({ where: { userId: f.user.id, systemOrigin: 'piggy' } }), 1);
    const history = await prisma.piggyTransaction.findMany({ where: { userId: f.user.id } });
    const balance = history.reduce((sum, movement) =>
      sum + (movement.type === 'withdraw' ? -Number(movement.amount) : Number(movement.amount)), 0);
    assert.equal(balance, 0);
  } finally {
    await f.cleanup();
  }
});

test('mixed provenance after normal withdrawal must reject synthetic credit', async () => {
  const f = await fixture();
  try {
    await depositToBank(f.user.id, f.bank.id, { amount: 300, note: null });
    await depositToBank(f.user.id, f.bank.id, { amount: 150, note: null, deductFromBalance: false });
    await withdrawFromBank(f.user.id, f.bank.id, { amount: 50, note: null });
    await assert.rejects(() => withdrawFromBank(f.user.id, f.bank.id, correction(200, 'debited')), (error: unknown) =>
      typeof error === 'object' && error !== null && 'status' in error && error.status === 409);
    assert.equal(await prisma.piggyTransaction.count({ where: { userId: f.user.id } }), 3);
    assert.equal(await prisma.entry.count({ where: { userId: f.user.id } }), 1);
  } finally {
    await f.cleanup();
  }
});

test('an ordinary withdrawal cannot impersonate a correction by forging its free-text note', async () => {
  const f = await fixture();
  try {
    await depositToBank(f.user.id, f.bank.id, { amount: 100, note: null });
    const fake = await withdrawFromBank(f.user.id, f.bank.id, {
      amount: 30,
      note: 'Correção de saldo incorreto [origem:debited] · texto inserido pelo usuário',
    });
    assert.equal(fake.transaction.entryId !== null, true);
    assert.equal(fake.transaction.correctionOrigin, null);
    await assert.rejects(() => withdrawFromBank(f.user.id, f.bank.id, correction(70, 'debited')), (error: unknown) =>
      typeof error === 'object' && error !== null && 'status' in error && error.status === 409);
    assert.equal(await prisma.piggyTransaction.count({ where: { userId: f.user.id } }), 2);
  } finally {
    await f.cleanup();
  }
});

test('CDI enabled or already accrued blocks correction before posting new interest', async () => {
  const f = await fixture();
  try {
    await depositToBank(f.user.id, f.bank.id, { amount: 100, note: null, deductFromBalance: false });
    await prisma.piggyBank.update({ where: { id: f.bank.id }, data: { yieldEnabled: true, cdiPercent: 100 } });
    await assert.rejects(() => withdrawFromBank(f.user.id, f.bank.id, correction(100, 'not_debited')), (error: unknown) =>
      typeof error === 'object' && error !== null && 'status' in error && error.status === 409);
    assert.equal(await prisma.piggyTransaction.count({ where: { userId: f.user.id } }), 1);
    await prisma.piggyBank.update({ where: { id: f.bank.id }, data: { yieldEnabled: false, cdiPercent: 0 } });
    await prisma.piggyTransaction.create({
      data: { userId: f.user.id, piggyBankId: f.bank.id, type: 'interest', source: 'yield', amount: 0.05, date: new Date() },
    });
    await assert.rejects(() => withdrawFromBank(f.user.id, f.bank.id, correction(100, 'not_debited')), (error: unknown) =>
      typeof error === 'object' && error !== null && 'status' in error && error.status === 409);
    assert.equal(await prisma.piggyTransaction.count({ where: { userId: f.user.id } }), 2);
    assert.equal(await prisma.entry.count({ where: { userId: f.user.id } }), 0);
  } finally {
    await f.cleanup();
  }
});
