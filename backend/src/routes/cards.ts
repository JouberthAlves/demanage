import { Router } from 'express';

import { bodyOf, paramOf, requireUserId } from '@/http/request';
import { serializeCard } from '@/lib/card-billing';
import { requireAuth } from '@/middlewares/require-auth';
import {
  archiveCard,
  createCard,
  listCards,
  parseCreateCard,
  parseUpdateCard,
  updateCard,
} from '@/services/cards';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const cards = await listCards(requireUserId(req));
  res.json(cards.map(serializeCard));
});

router.post('/', async (req, res) => {
  const input = parseCreateCard(bodyOf(req));
  const card = await createCard(requireUserId(req), input);
  res.status(201).json(serializeCard(card));
});

router.patch('/:id', async (req, res) => {
  const input = parseUpdateCard(bodyOf(req));
  const card = await updateCard(requireUserId(req), paramOf(req), input);
  res.json(serializeCard(card));
});

router.delete('/:id', async (req, res) => {
  const archived = await archiveCard(requireUserId(req), paramOf(req));
  res.json({ ok: true, archivedAt: archived.archivedAt });
});

export default router;
