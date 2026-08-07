import { Router, Request, Response } from 'express';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const existing = await prisma.card.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Cartão não encontrado' });
    }

    await prisma.$transaction(async (tx) => {
      const splitLinks = await tx.expenseSplit.findMany({
        where: { cardId: id, expense: { userId } },
        select: { expenseId: true },
      });
      const expenseIds = [...new Set(splitLinks.map((row) => row.expenseId))];

      await tx.expense.deleteMany({
        where: {
          userId,
          OR: [
            { cardId: id },
            ...(expenseIds.length > 0 ? [{ id: { in: expenseIds } }] : []),
          ],
        },
      });

      await tx.card.delete({ where: { id } });
    });

    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
