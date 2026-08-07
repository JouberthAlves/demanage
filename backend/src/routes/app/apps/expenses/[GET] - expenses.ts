import { Router, Request, Response } from 'express';

import { customTagSelect } from '@/lib/custom-tag';
import {
  expenseSplitInclude,
  serializeExpense,
} from '@/lib/expense-splits';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const expenses = await prisma.expense.findMany({
      where: { userId },
      include: {
        customTag: { select: customTagSelect },
        ...expenseSplitInclude,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(expenses.map(serializeExpense));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
