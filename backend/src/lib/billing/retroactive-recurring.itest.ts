import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { prisma } from '@/lib/prisma';
import { parseCreateExpense } from '@/services/expense-input';
import { createExpense } from '@/services/expenses';

const at = (day: string) => new Date(`${day}T12:00:00.000Z`);

test('F02: recurring card POST fails atomically if a prior billing cycle already closed', async () => {
  const user = await prisma.user.create({data:{name:'Retroactive billing guard',email:`f02-${randomUUID()}@example.invalid`,passwordHash:'test-only-hash'}});
  try {
    const card = await prisma.card.create({data:{userId:user.id,name:'Cycle closed card',closingDay:5,createdAt:at('2026-08-01'),lastInvoicedOn:at('2026-09-05'),lastBillingProcessedAt:at('2026-09-06')}});
    await assert.rejects(
      ()=>createExpense(user.id,parseCreateExpense({name:'Missing September charge',amount:100,category:'outro',frequency:'mensal',cardId:card.id,startsAt:'2026-09-01',dueDay:1})),
      /faturad|fechad/i,
    );
    assert.equal(await prisma.expense.count({where:{userId:user.id}}),0,'rejected recurrence must not create a partial expense');
    const valid = await createExpense(user.id,parseCreateExpense({name:'Only open cycle',amount:100,category:'outro',frequency:'mensal',cardId:card.id,startsAt:'2026-09-07',dueDay:10}));
    assert.equal(valid.cardId,card.id);
    assert.equal(await prisma.expenseObligationVersion.count({where:{expenseId:valid.id}}),1);
  } finally {
    const expenses=await prisma.expense.findMany({where:{userId:user.id},select:{id:true}});
    const ids=expenses.map(e=>e.id);
    await prisma.expenseObligationVersion.deleteMany({where:{expenseId:{in:ids}}});
    await prisma.expenseSplit.deleteMany({where:{expenseId:{in:ids}}});
    await prisma.expense.deleteMany({where:{userId:user.id}});
    await prisma.card.deleteMany({where:{userId:user.id}});
    await prisma.user.delete({where:{id:user.id}});
  }
});
