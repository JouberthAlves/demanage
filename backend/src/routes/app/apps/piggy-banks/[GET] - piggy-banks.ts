import { Router, Request, Response } from 'express';

import { catchUpPiggyInterest } from '@/lib/piggy-interest';
import { prisma } from '@/lib/prisma';
import {
  serializePiggyBank,
  serializePiggyTransaction,
} from '@/lib/piggy';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });

    await catchUpPiggyInterest(userId);
    const includeArchived = req.query.includeArchived === 'true';
    const banks = await prisma.piggyBank.findMany({
      where: {
        userId,
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      include: { transactions: true },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(banks.map(serializePiggyBank));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get(
  '/:id/transactions',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const id = String(req.params.id);
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });

      await catchUpPiggyInterest(userId);
      const bank = await prisma.piggyBank.findFirst({
        where: { id, userId },
      });
      if (!bank) return res.status(404).json({ error: 'Cofre não encontrado' });

      const transactions = await prisma.piggyTransaction.findMany({
        where: { piggyBankId: id, userId },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
      return res.json(transactions.map(serializePiggyTransaction));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
