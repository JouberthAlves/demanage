import { Router, Request, Response } from 'express';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const existing = await prisma.expense.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Despesa não encontrada' });
    }

    const { name, amount, category, frequency, cardId, dueDay, notes } =
      req.body;

    if (cardId) {
      const card = await prisma.card.findFirst({
        where: { id: cardId, userId },
      });

      if (!card) {
        return res.status(400).json({ error: 'Cartão inválido' });
      }
    }

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(amount !== undefined ? { amount } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(frequency !== undefined ? { frequency } : {}),
        ...(cardId !== undefined ? { cardId: cardId || null } : {}),
        ...(dueDay !== undefined ? { dueDay: dueDay || null } : {}),
        ...(notes !== undefined ? { notes: notes || null } : {}),
      },
    });

    return res.json(expense);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
