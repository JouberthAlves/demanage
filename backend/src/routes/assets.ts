import { Router } from 'express';

import {
  bodyOf,
  paramOf,
  parseAssetParam,
  requireUserId,
} from '@/http/request';
import { requireAuth } from '@/middlewares/require-auth';
import {
  createTransaction,
  getAssetSummaries,
  getAssetSummary,
  listAssetTransactions,
  parseAssetTransactionPatch,
  parseCreateAssetTransaction,
  patchTransaction,
  removeTransaction,
  serializeAssetTransaction,
} from '@/services/assets';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(await getAssetSummaries(requireUserId(req)));
});

router.get('/:asset', async (req, res) => {
  const asset = parseAssetParam(req);
  res.json(await getAssetSummary(requireUserId(req), asset));
});

router.get('/:asset/transactions', async (req, res) => {
  const asset = parseAssetParam(req);
  const transactions = await listAssetTransactions(requireUserId(req), asset);
  res.json(transactions.map(serializeAssetTransaction));
});

router.post('/:asset/transactions', async (req, res) => {
  const asset = parseAssetParam(req);
  const input = parseCreateAssetTransaction(bodyOf(req));
  const transaction = await createTransaction(requireUserId(req), asset, input);
  res.status(201).json(serializeAssetTransaction(transaction));
});

router.patch('/transactions/:id', async (req, res) => {
  const patch = parseAssetTransactionPatch(bodyOf(req));
  const transaction = await patchTransaction(
    requireUserId(req),
    paramOf(req),
    patch,
  );
  res.json(serializeAssetTransaction(transaction));
});

router.delete('/transactions/:id', async (req, res) => {
  await removeTransaction(requireUserId(req), paramOf(req));
  res.status(204).send();
});

export default router;
