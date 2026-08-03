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

    const existing = await prisma.card.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Cartão não encontrado' });
    }

    const { name, limit, closingDay, dueDay } = req.body;

    const card = await prisma.card.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(limit !== undefined ? { limit: limit || null } : {}),
        ...(closingDay !== undefined ? { closingDay: closingDay || null } : {}),
        ...(dueDay !== undefined ? { dueDay: dueDay || null } : {}),
      },
    });

    return res.json(card);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
