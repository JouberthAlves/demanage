import { Router } from 'express';

import { bodyOf, paramOf, requireUserId } from '@/http/request';
import { requireAuth } from '@/middlewares/require-auth';
import {
  parseCreateExpense,
  parsePayExpenseBody,
  parseUpdateExpense,
} from '@/services/expense-input';
import {
  archiveExpense,
  createExpense,
  listExpenses,
  payExpense,
  serializeExpense,
  updateExpense,
} from '@/services/expenses';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const expenses = await listExpenses(requireUserId(req));
  res.json(expenses.map(serializeExpense));
});

router.post('/', async (req, res) => {
  const input = parseCreateExpense(bodyOf(req));
  const expense = await createExpense(requireUserId(req), input);
  res.status(201).json(serializeExpense(expense));
});

router.post('/:id/pay', async (req, res) => {
  const month = parsePayExpenseBody(bodyOf(req));
  const expense = await payExpense(requireUserId(req), paramOf(req), month);
  res.json(serializeExpense(expense));
});

router.patch('/:id', async (req, res) => {
  const input = parseUpdateExpense(bodyOf(req));
  const expense = await updateExpense(requireUserId(req), paramOf(req), input);
  res.json(serializeExpense(expense));
});

router.delete('/:id', async (req, res) => {
  await archiveExpense(requireUserId(req), paramOf(req));
  res.status(204).send();
});

export default router;
