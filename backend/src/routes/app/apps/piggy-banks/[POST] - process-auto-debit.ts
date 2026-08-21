import { Router, Request, Response } from 'express';

import { catchUpPiggyInterest } from '@/lib/piggy-interest';
import { processPiggyAutoDebits } from '@/lib/piggy';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.post(
  '/process-auto-debit',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Não autenticado' });
      }

      const interest = await catchUpPiggyInterest(userId);
      const autoDebit = await processPiggyAutoDebits(userId);
      return res.json({
        createdCount: autoDebit.createdCount,
        interestCreatedCount: interest.createdCount,
        interestStale: interest.stale,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
