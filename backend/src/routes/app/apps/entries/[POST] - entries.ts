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

    const { name, amount, type, frequency, date } = req.body;

    if (!name || amount == null || !type || !frequency) {
      return res.status(400).json({
        error: 'Campos obrigatórios: name, amount, type, frequency',
      });
    }

    const entry = await prisma.entry.create({
      data: {
        userId,
        name,
        amount,
        type,
        frequency,
        date: date ? new Date(date) : undefined,
      },
    });

    return res.status(201).json(entry);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
