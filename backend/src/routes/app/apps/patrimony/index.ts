import { Router, Request, Response } from 'express';

import {
  getPatrimonyHistory,
  PatrimonyError,
  savePatrimonySettings,
} from '@/lib/patrimony';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.get('/settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    const settings = await prisma.patrimonySettings.findUnique({
      where: { userId },
    });
    if (!settings) return res.json(null);
    return res.json({
      baseDate: settings.baseDate.toISOString().slice(0, 10),
      openingCashBrl: settings.openingCashBrl.toString(),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    const settings = await savePatrimonySettings(
      userId,
      req.body?.baseDate,
      req.body?.openingCashBrl,
    );
    return res.json({
      baseDate: settings.baseDate.toISOString().slice(0, 10),
      openingCashBrl: settings.openingCashBrl.toString(),
    });
  } catch (err) {
    if (err instanceof PatrimonyError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/summary', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    const result = await getPatrimonyHistory(userId);
    return res.json({
      settings: result.settings,
      summary: result.summary,
      stale: result.stale,
    });
  } catch (err) {
    if (err instanceof PatrimonyError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(503).json({
      error: 'Dados patrimoniais indisponíveis e sem cache suficiente',
    });
  }
});

router.get('/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    const from =
      typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    return res.json(await getPatrimonyHistory(userId, from, to));
  } catch (err) {
    if (err instanceof PatrimonyError) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    return res.status(503).json({
      error: 'Dados patrimoniais indisponíveis e sem cache suficiente',
    });
  }
});

export default router;
