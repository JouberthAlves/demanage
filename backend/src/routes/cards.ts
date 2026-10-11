import { Router } from 'express';

import { bodyOf, paramOf, requireUserId } from '@/http/request';
import { serializeCard } from '@/lib/card-billing';
import { getCommittedByCard } from '@/lib/expense-splits';
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
  const userId = requireUserId(req);
  const [cards, committed] = await Promise.all([
    listCards(userId),
    getCommittedByCard({ userId }),
  ]);
  res.json(cards.map((card) => serializeCard(card, committed.get(card.id))));
});

router.post('/', async (req, res) => {
  const input = parseCreateCard(bodyOf(req));
  const userId = requireUserId(req);
  const card = await createCard(userId, input);
  const committed = await getCommittedByCard({ userId });
  res.status(201).json(serializeCard(card, committed.get(card.id)));
});

router.patch('/:id', async (req, res) => {
  const input = parseUpdateCard(bodyOf(req));
  const userId = requireUserId(req);
  const card = await updateCard(userId, paramOf(req), input);
  const committed = await getCommittedByCard({ userId });
  res.json(serializeCard(card, committed.get(card.id)));
});

router.delete('/:id', async (req, res) => {
  const archived = await archiveCard(requireUserId(req), paramOf(req));
  res.json({ ok: true, archivedAt: archived.archivedAt });
});

export default router;
