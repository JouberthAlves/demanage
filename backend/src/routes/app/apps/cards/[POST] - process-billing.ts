import { Router, Request, Response } from 'express';

import { processUserCardBilling } from '@/lib/card-billing';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.post('/process-billing', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const result = await processUserCardBilling(userId);
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
