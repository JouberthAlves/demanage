import { Router } from 'express';

import { requireUserId } from '@/http/request';
import { processUserCardBilling } from '@/lib/card-billing';
import { requireAuth } from '@/middlewares/require-auth';
import { processAutoDebit } from '@/services/piggy-banks';

/** Endpoints disparados pelo cliente para processar rotinas pendentes. */
const router = Router();

router.post('/cards/process-billing', requireAuth, async (req, res) => {
  res.json(await processUserCardBilling(requireUserId(req)));
});

router.post(
  '/piggy-banks/process-auto-debit',
  requireAuth,
  async (req, res) => {
    const interest = await processAutoDebit(requireUserId(req));
    res.json({
      createdCount: interest.autoDebitCreatedCount,
      autoDebitFailedCount: interest.autoDebitFailedCount,
      interestCreatedCount: interest.createdCount,
      interestStale: interest.stale,
    });
  },
);

export default router;
