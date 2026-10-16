import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';

import { previewFinanceOperation, verifyIntent } from './finance-preview';

const secret = 'test-only-preview-intent-secret-with-more-than-32-bytes';
const draft = {
  kind: 'receive_and_save',
  amountCents: 2_000,
  dateKey: '2026-10-16',
  description: 'Presente da minha vó',
  tagName: 'Presente',
};

async function createTestUser() {
  return prisma.user.create({
    data: {
      name: 'Preview finance test',
      email: 'preview-' + randomUUID() + '@example.invalid',
      passwordHash: 'test',
    },
  });
}

async function cleanup(userIds: string[]) {
  await prisma.piggyTransaction.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.piggyBank.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test('preview resolves exact user-owned bank and signs canonical ID without DB writes', async () => {
  const me = await createTestUser();
  const other = await createTestUser();
  try {
    const bank = await prisma.piggyBank.create({
      data: { userId: me.id, name: 'Pórco', monthlyGoal: 0, goalAmount: 25 },
    });
    await prisma.piggyBank.create({
      data: { userId: other.id, name: 'Pórco', monthlyGoal: 0 },
    });
    await prisma.piggyTransaction.create({
      data: { userId: me.id, piggyBankId: bank.id, type: 'deposit', date: new Date('2026-10-10T12:00:00.000Z'), amount: 5 },
    });
    const identity = { userId: me.id, clientId: 'client-1' };
    const counts = () => Promise.all([
      prisma.entry.count({ where: { userId: me.id } }),
      prisma.entryReceipt.count({ where: { entry: { userId: me.id } } }),
      prisma.expense.count({ where: { userId: me.id } }),
      prisma.customTag.count({ where: { userId: me.id } }),
      prisma.piggyTransaction.count({ where: { userId: me.id } }),
    ]);
    const before = await counts();
    const preview = await previewFinanceOperation(identity, { ...draft, bankName: 'póRco' }, { secret });
    assert.equal(preview.status, 'ready');
    if (preview.status !== 'ready') return;
    assert.deepEqual(preview.effects, { cashDeltaCents: 0, piggyDeltaCents: 2_000 });
    assert.deepEqual(verifyIntent(preview.intentToken, identity, { secret }), {
      kind: 'receive_and_save',
      amountCents: 2_000,
      dateKey: '2026-10-16',
      description: 'Presente da minha vó',
      tagName: 'Presente',
      bankId: bank.id,
    });
    assert.deepEqual(await counts(), before);
  } finally {
    await cleanup([me.id, other.id]);
  }
});

test('foreign, archived, duplicate and approximate bank references ask to clarify', async () => {
  const me = await createTestUser();
  const other = await createTestUser();
  try {
    const foreign = await prisma.piggyBank.create({ data: { userId: other.id, name: 'Porco', monthlyGoal: 0 } });
    await prisma.piggyBank.create({ data: { userId: me.id, name: 'Porco', monthlyGoal: 0, archivedAt: new Date() } });
    await prisma.piggyBank.create({ data: { userId: me.id, name: 'Duplicado', monthlyGoal: 0 } });
    await prisma.piggyBank.create({ data: { userId: me.id, name: 'Duplicado', monthlyGoal: 0 } });
    const identity = { userId: me.id, clientId: 'client-1' };
    for (const target of [
      { bankId: foreign.id },
      { bankName: 'Porco' },
      { bankName: 'Duplicado' },
      { bankName: 'Porc' },
      { bankName: 'Pórco' },
      { bankName: 'Duplicado', bankId: foreign.id },
    ]) {
      const result = await previewFinanceOperation(identity, { ...draft, ...target }, { secret });
      assert.equal(result.status, 'clarification_required', JSON.stringify(target));
      if (result.status === 'clarification_required') assert.ok(result.questions.length > 0);
    }
  } finally {
    await cleanup([me.id, other.id]);
  }
});

test('goal cap and completed bank cannot silently reduce a requested transfer', async () => {
  const me = await createTestUser();
  try {
    const bank = await prisma.piggyBank.create({ data: { userId: me.id, name: 'Meta', goalAmount: 8, monthlyGoal: 0 } });
    const identity = { userId: me.id, clientId: 'client-1' };
    for (const amountCents of [2_000, 800]) {
      const result = await previewFinanceOperation(identity, { ...draft, amountCents, bankId: bank.id }, { secret });
      assert.equal(result.status, amountCents === 2_000 ? 'clarification_required' : 'ready');
    }
    await prisma.piggyTransaction.create({
      data: { userId: me.id, piggyBankId: bank.id, type: 'interest', amount: 8, date: new Date('2026-10-10T12:00:00.000Z') },
    });
    const full = await previewFinanceOperation(identity, { ...draft, bankId: bank.id }, { secret });
    assert.equal(full.status, 'clarification_required');
  } finally {
    await cleanup([me.id]);
  }
});

test('deposit existing money signs explicit cash deduction choice', async () => {
  const me = await createTestUser();
  try {
    const bank = await prisma.piggyBank.create({ data: { userId: me.id, name: 'Porco', monthlyGoal: 0 } });
    const identity = { userId: me.id, clientId: 'client-1' };
    const base = { kind: 'deposit_existing_cash', dateKey: '2026-10-16', amountCents: 2_000, bankId: bank.id };
    assert.equal((await previewFinanceOperation(identity, base, { secret })).status, 'clarification_required');
    for (const deductFromBalance of [true, false]) {
      const preview = await previewFinanceOperation(identity, { ...base, deductFromBalance, note: 'Da poupança' }, { secret });
      assert.equal(preview.status, 'ready');
      if (preview.status !== 'ready') continue;
      assert.deepEqual(preview.effects, {
        cashDeltaCents: deductFromBalance ? -2_000 : 0,
        piggyDeltaCents: 2_000,
      });
      assert.deepEqual(verifyIntent(preview.intentToken, identity, { secret }), {
        kind: 'deposit_existing_cash',
        dateKey: '2026-10-16',
        amountCents: 2_000,
        bankId: bank.id,
        deductFromBalance,
        note: 'Da poupança',
      });
    }
  } finally {
    await cleanup([me.id]);
  }
});
