import { Router, Request, Response } from 'express';

import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const id = String(req.params.id);
    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const deleted = await withUserWriteLockTransaction(userId, async (tx) => {
      const existing = await tx.piggyBank.findFirst({
        where: { id, userId },
      });
      if (!existing) return false;
      await tx.piggyBank.delete({ where: { id } });
      return true;
    });
    if (!deleted)
      return res.status(404).json({ error: 'Cofre não encontrado' });
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
