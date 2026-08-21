import { Router, Request, Response } from 'express';

import { parseAbnt2Text } from '@/lib/abnt2';
import {
  assetSummary,
  AssetValidationError,
  createAssetTransaction,
  deleteAssetTransaction,
  parseAsset,
  serializeAssetTransaction,
} from '@/lib/assets';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    const [btc, usd] = await Promise.all([
      assetSummary(userId, 'BTC'),
      assetSummary(userId, 'USD'),
    ]);
    return res.json({ BTC: btc, USD: usd });
  } catch (err) {
    console.error(err);
    return res.status(503).json({
      error: 'Não foi possível obter as cotações e não há cache suficiente',
    });
  }
});

router.get('/:asset', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const asset = parseAsset(String(req.params.asset).toUpperCase());
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    if (!asset) return res.status(400).json({ error: 'Ativo inválido' });
    return res.json(await assetSummary(userId, asset));
  } catch (err) {
    console.error(err);
    return res.status(503).json({ error: 'Cotação indisponível e sem cache' });
  }
});

router.get(
  '/:asset/transactions',
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const asset = parseAsset(String(req.params.asset).toUpperCase());
    if (!userId) return res.status(401).json({ error: 'Não autenticado' });
    if (!asset) return res.status(400).json({ error: 'Ativo inválido' });
    const transactions = await prisma.assetTransaction.findMany({
      where: { userId, asset },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return res.json(transactions.map(serializeAssetTransaction));
  },
);

router.post(
  '/:asset/transactions',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const asset = parseAsset(String(req.params.asset).toUpperCase());
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });
      if (!asset) return res.status(400).json({ error: 'Ativo inválido' });
      const type = req.body?.type;
      if (
        type !== 'BUY' &&
        type !== 'SELL' &&
        type !== 'MANUAL_ADJUSTMENT'
      ) {
        return res
          .status(400)
          .json({ error: 'Tipo de movimentação inválido' });
      }
      const note =
        typeof req.body?.note === 'string'
          ? parseAbnt2Text(req.body.note, { maxLength: 500 }) || null
          : null;
      const transaction = await createAssetTransaction({
        userId,
        asset,
        type,
        quantity: req.body?.quantity,
        cashAmountBrl: req.body?.cashAmountBrl,
        feeAmountBrl: req.body?.feeAmountBrl,
        feePercent: req.body?.feePercent,
        costBasisKnown: req.body?.costBasisKnown,
        date: req.body?.date,
        note,
      });
      return res.status(201).json(serializeAssetTransaction(transaction));
    } catch (err) {
      if (err instanceof AssetValidationError) {
        return res.status(400).json({ error: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.delete(
  '/transactions/:id',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Não autenticado' });
      await deleteAssetTransaction(userId, String(req.params.id));
      return res.status(204).send();
    } catch (err) {
      if (err instanceof AssetValidationError) {
        return res.status(400).json({ error: err.message });
      }
      console.error(err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
