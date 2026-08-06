import { Router, Request, Response } from 'express';

import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const scope = req.query.scope;

    if (scope !== 'expense' && scope !== 'income') {
      return res.status(400).json({
        error: 'Query obrigatória: scope=expense|income',
      });
    }

    const tags = await prisma.customTag.findMany({
      where: { userId, scope },
      orderBy: { name: 'asc' },
    });

    return res.json(tags);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
