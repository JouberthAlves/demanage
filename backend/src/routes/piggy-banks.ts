import { Router } from 'express';

import { bodyOf, paramOf, queryString, requireUserId } from '@/http/request';
import { serializePiggyBank, serializePiggyTransaction } from '@/lib/piggy';
import { requireAuth } from '@/middlewares/require-auth';
import {
  archivePiggyBank,
  createPiggyBank,
  deletePiggyBank,
  depositToBank,
  listPiggyBanks,
  listPiggyTransactions,
  parseCreatePiggy,
  parseMoneyMovement,
  parseUpdatePiggy,
  updatePiggyBank,
  withdrawFromBank,
} from '@/services/piggy-banks';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const includeArchived = queryString(req, 'includeArchived') === 'true';
  const banks = await listPiggyBanks(requireUserId(req), includeArchived);
  res.json(banks.map(serializePiggyBank));
});

router.get('/:id/transactions', async (req, res) => {
  const transactions = await listPiggyTransactions(
    requireUserId(req),
    paramOf(req),
  );
  res.json(transactions.map(serializePiggyTransaction));
});

router.post('/', async (req, res) => {
  const input = parseCreatePiggy(bodyOf(req));
  const bank = await createPiggyBank(requireUserId(req), input);
  res.status(201).json(serializePiggyBank(bank));
});

router.post('/:id/deposit', async (req, res) => {
  const movement = parseMoneyMovement(bodyOf(req));
  const result = await depositToBank(
    requireUserId(req),
    paramOf(req),
    movement,
  );
  res.status(201).json({
    bank: serializePiggyBank(result.bank),
    transaction: serializePiggyTransaction(result.transaction),
    completed: result.completed,
    depositAmount: result.depositAmount,
  });
});

router.post('/:id/withdraw', async (req, res) => {
  const movement = parseMoneyMovement(bodyOf(req));
  const result = await withdrawFromBank(
    requireUserId(req),
    paramOf(req),
    movement,
  );
  res.status(201).json({
    bank: serializePiggyBank(result.bank),
    transaction: serializePiggyTransaction(result.transaction),
    isEmergency: result.bank.isEmergency,
  });
});

router.post('/:id/archive', async (req, res) => {
  const bank = await archivePiggyBank(requireUserId(req), paramOf(req));
  res.json(serializePiggyBank(bank));
});

router.patch('/:id', async (req, res) => {
  const input = parseUpdatePiggy(bodyOf(req));
  const bank = await updatePiggyBank(requireUserId(req), paramOf(req), input);
  res.json(serializePiggyBank(bank));
});

router.delete('/:id', async (req, res) => {
  await deletePiggyBank(requireUserId(req), paramOf(req));
  res.status(204).send();
});

export default router;
