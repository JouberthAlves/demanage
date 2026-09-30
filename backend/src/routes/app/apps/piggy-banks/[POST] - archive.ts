import { Router, Request, Response } from 'express';

import {
  balanceFromTransactions,
  piggyGoalAmount,
  serializePiggyBank,
} from '@/lib/piggy';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.post(
  '/:id/archive',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const id = String(req.params.id);
      if (!userId) {
        return res.status(401).json({ error: 'Não autenticado' });
      }

      const result = await withUserWriteLockTransaction(userId, async (tx) => {
        const bank = await tx.piggyBank.findFirst({
          where: { id, userId },
          include: { transactions: true },
        });
        if (!bank) return { error: 'Cofre não encontrado', status: 404 };
        if (bank.archivedAt)
          return { error: 'Cofre já arquivado', status: 400 };

        const balance = balanceFromTransactions(bank.transactions);
        const goalAmount = piggyGoalAmount(bank.goalAmount);
        const goalReached =
          goalAmount == null ||
          Boolean(bank.completedAt) ||
          balance >= goalAmount;
        if (!goalReached) {
          return {
            error: 'Arquivar só é permitido após atingir a meta',
            status: 400,
          };
        }

        const updated = await tx.piggyBank.update({
          where: { id },
          data: { archivedAt: new Date() },
          include: { transactions: true },
        });
        return { bank: updated };
      });

      if ('error' in result) {
        return res.status(result.status ?? 400).json({ error: result.error });
      }
      return res.json(serializePiggyBank(result.bank));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
