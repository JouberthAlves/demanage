import { Router } from 'express';

import { bodyOf, paramOf, queryString, requireUserId } from '@/http/request';
import { requireAuth } from '@/middlewares/require-auth';
import {
  createCustomTag,
  deleteCustomTag,
  listCustomTags,
  parseCreateCustomTag,
  parseTagScope,
} from '@/services/custom-tags';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const scope = parseTagScope(
    queryString(req, 'scope'),
    'Query obrigatória: scope=expense|income',
  );
  res.json(await listCustomTags(requireUserId(req), scope));
});

router.post('/', async (req, res) => {
  const input = parseCreateCustomTag(bodyOf(req));
  const tag = await createCustomTag(requireUserId(req), input);
  res.status(201).json(tag);
});

router.delete('/:id', async (req, res) => {
  await deleteCustomTag(requireUserId(req), paramOf(req));
  res.status(204).send();
});

export default router;
