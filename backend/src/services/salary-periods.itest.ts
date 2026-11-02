import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { dayKeyInSaoPaulo } from '@/lib/civil-date';
import { prisma } from '@/lib/prisma';

import { setReceiptState } from './entries';
import { updateProfile } from './profile';

function period(offset: number) {
  const now = dayKeyInSaoPaulo(new Date());
  const [year, month] = now.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1 + offset, 1, 12))
    .toISOString()
    .slice(0, 7);
}

test('salary rate changes preserve prior months and each receipt hold independently', async () => {
  const user = await prisma.user.create({
    data: {
      name: 'Salary periods',
      email: `salary-periods-${randomUUID()}@example.invalid`,
      passwordHash: 'test-only',
      salary: '3000.00',
    },
  });
  const older = period(-2);
  const previous = period(-1);
  const current = period(0);
  try {
    const entry = await prisma.entry.create({
      data: {
        userId: user.id,
        name: 'Salário',
        type: 'salario',
        frequency: 'mensal',
        receiveDay: 5,
        amount: '3000.00',
        startsAt: new Date(`${older}-01T12:00:00.000Z`),
        createdAt: new Date(`${older}-01T12:00:00.000Z`),
        salaryVersions: {
          create: { month: older, amount: '3000.00', receiveDay: 5 },
        },
      },
    });

    await setReceiptState(user.id, entry.id, older, 'waiting');
    await setReceiptState(user.id, entry.id, previous, 'waiting');
    await updateProfile(user.id, { salary: 4000, salaryReceiveDay: 8 });

    const afterRaise = await prisma.entry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { salaryVersions: true, salaryHolds: true },
    });
    assert.equal(Number(afterRaise.amount), 4000);
    assert.deepEqual(afterRaise.salaryHolds.map((row) => row.month).sort(), [
      older,
      previous,
    ]);
    assert.equal(
      afterRaise.salaryVersions
        .find((row) => row.month === older)
        ?.amount.toString(),
      '3000',
    );
    assert.equal(
      afterRaise.salaryVersions
        .find((row) => row.month === current)
        ?.amount.toString(),
      '4000',
    );

    const confirmedOlder = await setReceiptState(
      user.id,
      entry.id,
      older,
      'received',
    );
    assert.equal(Number(confirmedOlder.receipts?.[0]?.amount), 3000);
    const afterOne = await prisma.entry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { salaryHolds: true },
    });
    assert.deepEqual(
      afterOne.salaryHolds.map((row) => row.month),
      [previous],
    );

    await updateProfile(user.id, { salary: 0 });
    const afterZero = await prisma.entry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { salaryVersions: true, receipts: true, salaryHolds: true },
    });
    assert.equal(
      afterZero.salaryVersions
        .find((row) => row.month === current)
        ?.amount.toString(),
      '0',
    );
    assert.equal(Number(afterZero.receipts[0]?.amount), 3000);
    assert.deepEqual(
      afterZero.salaryHolds.map((row) => row.month),
      [previous],
    );
    await setReceiptState(user.id, entry.id, previous, 'automatic');
    assert.equal(
      await prisma.salaryHold.count({ where: { entryId: entry.id } }),
      0,
    );
  } finally {
    await prisma.entryReceipt.deleteMany({
      where: { entry: { userId: user.id } },
    });
    await prisma.salaryHold.deleteMany({
      where: { entry: { userId: user.id } },
    });
    await prisma.salaryVersion.deleteMany({
      where: { entry: { userId: user.id } },
    });
    await prisma.entry.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
});
