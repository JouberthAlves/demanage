import { Router } from 'express';

import { parseAssetParam, queryString } from '@/http/request';
import { requireAuth } from '@/middlewares/require-auth';
import {
  getAssetHistorySeries,
  getAssetQuoteFor,
  getCdiSeries,
  getIpcaSeries,
  resolveHistoryRange,
} from '@/services/market';

const router = Router();
router.use(requireAuth);

function rangeOf(req: Parameters<typeof queryString>[0]) {
  return resolveHistoryRange(queryString(req, 'from'), queryString(req, 'to'));
}

router.get('/quote/:asset', async (req, res) => {
  res.json(await getAssetQuoteFor(parseAssetParam(req)));
});

router.get('/history/:asset', async (req, res) => {
  const asset = parseAssetParam(req);
  res.json(await getAssetHistorySeries(asset, rangeOf(req)));
});

router.get('/cdi', async (req, res) => {
  res.json(await getCdiSeries(rangeOf(req)));
});

router.get('/ipca', async (req, res) => {
  res.json(await getIpcaSeries(rangeOf(req)));
});

export default router;
