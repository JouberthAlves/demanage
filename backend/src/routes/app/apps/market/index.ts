import { Router, Request, Response } from 'express';

import { parseAsset } from '@/lib/assets';
import {
  getAssetHistory,
  getAssetQuote,
  getCdiHistory,
  getIpcaHistory,
  MarketDataError,
} from '@/lib/market-data';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

function dateRange(req: Request) {
  const today = new Date().toISOString().slice(0, 10);
  const from = typeof req.query.from === 'string' ? req.query.from : today;
  const to = typeof req.query.to === 'string' ? req.query.to : today;
  return { from, to };
}

router.get('/quote/:asset', requireAuth, async (req: Request, res: Response) => {
  try {
    const asset = parseAsset(String(req.params.asset).toUpperCase());
    if (!asset) return res.status(400).json({ error: 'Ativo inválido' });
    return res.json(await getAssetQuote(asset));
  } catch (err) {
    console.error(err);
    return res.status(503).json({ error: 'Cotação indisponível e sem cache' });
  }
});

router.get(
  '/history/:asset',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const asset = parseAsset(String(req.params.asset).toUpperCase());
      if (!asset) return res.status(400).json({ error: 'Ativo inválido' });
      const { from, to } = dateRange(req);
      return res.json(await getAssetHistory(asset, from, to));
    } catch (err) {
      const message =
        err instanceof MarketDataError ? err.message : 'Histórico indisponível';
      return res.status(503).json({ error: message });
    }
  },
);

router.get('/cdi', requireAuth, async (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    return res.json(await getCdiHistory(from, to));
  } catch (err) {
    const message =
      err instanceof MarketDataError ? err.message : 'CDI indisponível';
    return res.status(503).json({ error: message });
  }
});

router.get('/ipca', requireAuth, async (req: Request, res: Response) => {
  try {
    const { from, to } = dateRange(req);
    return res.json(await getIpcaHistory(from, to));
  } catch (err) {
    const message =
      err instanceof MarketDataError ? err.message : 'IPCA indisponível';
    return res.status(503).json({ error: message });
  }
});

export default router;
