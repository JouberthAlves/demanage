import { Router, Request, Response } from 'express';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const { name, amount, category, frequency, cardId, dueDay, notes } =
      req.body;

    if (!name || amount == null || !category) {
      return res.status(400).json({
        error: 'Campos obrigatórios: name, amount, category',
      });
    }

    const resolvedCardId = cardId || null;

    if (resolvedCardId) {
      const card = await prisma.card.findFirst({
        where: { id: resolvedCardId, userId },
      });

      if (!card) {
        return res.status(400).json({ error: 'Cartão inválido' });
      }
    }

    const expense = await prisma.expense.create({
      data: {
        userId,
        name,
        amount,
        category,
        frequency: frequency ?? 'mensal',
        cardId: resolvedCardId,
        dueDay: dueDay ?? null,
        notes: notes || null,
      },
    });

    return res.status(201).json(expense);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
