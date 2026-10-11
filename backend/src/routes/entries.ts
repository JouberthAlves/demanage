import { Router } from 'express';

import { bodyOf, paramOf, requireUserId } from '@/http/request';
import { requireAuth } from '@/middlewares/require-auth';
import {
  archiveEntry,
  createEntry,
  listEntries,
  parseCreateEntry,
  parseReceiptStateBody,
  parseUpdateEntry,
  serializeEntry,
  setReceiptState,
  updateEntry,
} from '@/services/entries';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const entries = await listEntries(requireUserId(req));
  res.json(entries.map(serializeEntry));
});

router.post('/', async (req, res) => {
  const input = parseCreateEntry(bodyOf(req));
  const entry = await createEntry(requireUserId(req), input);
  res.status(201).json(serializeEntry(entry));
});

router.post('/:id/receipt-state', async (req, res) => {
  const { month, state } = parseReceiptStateBody(bodyOf(req));
  const entry = await setReceiptState(
    requireUserId(req),
    paramOf(req),
    month,
    state,
  );
  res.json(serializeEntry(entry));
});

router.patch('/:id', async (req, res) => {
  const input = parseUpdateEntry(bodyOf(req));
  const entry = await updateEntry(requireUserId(req), paramOf(req), input);
  res.json(serializeEntry(entry));
});

router.delete('/:id', async (req, res) => {
  await archiveEntry(requireUserId(req), paramOf(req));
  res.status(204).send();
});

export default router;
