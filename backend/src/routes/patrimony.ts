import { Router } from 'express';

import { bodyOf, queryString, requireUserId } from '@/http/request';
import { requireAuth } from '@/middlewares/require-auth';
import {
  patrimonyHistory,
  patrimonySummary,
  readPatrimonySettings,
  writePatrimonySettings,
} from '@/services/patrimony';

const router = Router();
router.use(requireAuth);

router.get('/settings', async (req, res) => {
  res.json(await readPatrimonySettings(requireUserId(req)));
});

router.put('/settings', async (req, res) => {
  const body = bodyOf(req);
  res.json(
    await writePatrimonySettings(
      requireUserId(req),
      body.baseDate,
      body.openingCashBrl,
    ),
  );
});

router.get('/summary', async (req, res) => {
  res.json(await patrimonySummary(requireUserId(req)));
});

router.get('/history', async (req, res) => {
  res.json(
    await patrimonyHistory(
      requireUserId(req),
      queryString(req, 'from'),
      queryString(req, 'to'),
    ),
  );
});

export default router;
