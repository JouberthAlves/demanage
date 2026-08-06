import { Router, Request, Response } from 'express';

import { prisma } from '@/lib/prisma';
import { balanceFromTransactions, serializePiggyBank } from '@/lib/piggy';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.post('/:id/archive', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const bank = await prisma.piggyBank.findFirst({
      where: { id, userId },
      include: { transactions: true },
    });

    if (!bank) {
      return res.status(404).json({ error: 'Cofre não encontrado' });
    }

    if (bank.archivedAt) {
      return res.status(400).json({ error: 'Cofre já arquivado' });
    }

    const balance = balanceFromTransactions(bank.transactions);
    const goalReached =
      Boolean(bank.completedAt) || balance >= Number(bank.goalAmount);

    if (!goalReached) {
      return res.status(400).json({
        error: 'Arquivar só é permitido após atingir a meta',
      });
    }

    const updated = await prisma.piggyBank.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: { transactions: true },
    });

    return res.json(serializePiggyBank(updated));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
