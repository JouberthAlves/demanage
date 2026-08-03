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

    const { name, limit, closingDay, dueDay } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ error: 'Campo obrigatório: name' });
    }

    const card = await prisma.card.create({
      data: {
        userId,
        name: name.trim(),
        limit: limit ?? null,
        closingDay: closingDay ?? null,
        dueDay: dueDay ?? null,
      },
    });

    return res.status(201).json(card);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
