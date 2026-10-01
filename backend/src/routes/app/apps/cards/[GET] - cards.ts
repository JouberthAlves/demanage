import { Router, Request, Response } from 'express';

import { serializeCard } from '@/lib/card-billing';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const cards = await prisma.card.findMany({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(cards.map(serializeCard));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
