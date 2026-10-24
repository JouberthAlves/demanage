import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';

import { getFinancialOverview } from './financial-overview';

test('MCP keeps recorded cash after archiving parents, without including system movements', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'MCP archive cash history',
      email: `mcp-history-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only',
    },
  });
  try {
    const expense = await prisma.expense.create({
      data: {
        userId: user.id,
        name: 'Pagamento manual',
        category: 'outro',
        frequency: 'unica',
        amount: 999,
        occurredAt: new Date('2026-10-02T12:00:00.000Z'),
        payments: { create: [{
          month: '2026-10', amount: 35,
          paidAt: new Date('2026-10-11T14:00:00.000Z'),
        }] },
      },
    });
    const entry = await prisma.entry.create({
      data: {
        userId: user.id,
        name: 'Recebimento manual',
        type: 'outro',
        frequency: 'unica',
        amount: 999,
        date: new Date('2026-10-02T12:00:00.000Z'),
        receipts: { create: [{
          month: '2026-10', amount: 45,
          receivedAt: new Date('2026-10-10T14:00:00.000Z'),
        }] },
      },
    });
    await prisma.expense.create({
      data: {
        userId: user.id,
        name: 'Não incluir sistema',
        category: 'outro',
        frequency: 'unica',
        systemOrigin: 'asset',
        amount: 800,
        occurredAt: new Date('2026-10-10T12:00:00.000Z'),
      },
    });

    const now = new Date('2026-10-18T18:00:00.000Z');
    const before = (await getFinancialOverview(user.id, now)).monthly;
    assert.deepEqual(before, {
      month: '2026-10', incomeBrl: '45.00',
      expensesBrl: '35.00', balanceBrl: '10.00',
    });

    await prisma.expense.update({ where: { id: expense.id }, data: { archivedAt: now } });
    await prisma.entry.update({ where: { id: entry.id }, data: { archivedAt: now } });
    const after = (await getFinancialOverview(user.id, now)).monthly;
    assert.deepEqual(after, before);
  } finally {
    await prisma.expensePayment.deleteMany({ where: { expense: { userId: user.id } } });
    await prisma.entryReceipt.deleteMany({ where: { entry: { userId: user.id } } });
    await prisma.expense.deleteMany({ where: { userId: user.id } });
    await prisma.entry.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});

test('MCP counts all prepaid recurring payments by paidAt and never charges settled future cycles again', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'MCP advance cash history',
      email: `mcp-prepay-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only',
    },
  });
  try {
    await prisma.expense.create({
      data: {
        userId: user.id,
        name: 'Pagamento mensal antecipado',
        category: 'outro',
        frequency: 'mensal',
        amount: 100,
        dueDay: 10,
        startsAt: new Date('2026-10-01T00:00:00.000Z'),
        paidForMonth: '2026-12',
        payments: { create: [
          { month: '2026-10', amount: 80, paidAt: new Date('2026-10-02T14:00:00.000Z') },
          { month: '2026-11', amount: 90, paidAt: new Date('2026-10-03T14:00:00.000Z') },
          { month: '2026-12', amount: 70, paidAt: new Date('2026-10-04T14:00:00.000Z') },
        ] },
      },
    });
    const october = (await getFinancialOverview(user.id, new Date('2026-10-18T18:00:00.000Z'))).monthly;
    assert.equal(october.expensesBrl, '240.00');
    const november = (await getFinancialOverview(user.id, new Date('2026-11-18T18:00:00.000Z'))).monthly;
    assert.equal(november.expensesBrl, '0.00');
  } finally {
    await prisma.expensePayment.deleteMany({ where: { expense: { userId: user.id } } });
    await prisma.expense.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
