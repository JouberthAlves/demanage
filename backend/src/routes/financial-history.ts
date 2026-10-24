import { Router } from 'express';

import { requireUserId } from '@/http/request';
import { requireAuth } from '@/middlewares/require-auth';
import { serializeEntry } from '@/services/entries';
import { serializeExpense } from '@/services/expenses';
import { listFinancialHistory } from '@/services/financial-history';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { expenses, incomes } = await listFinancialHistory(requireUserId(req));
  res.json({
    expenses: expenses.map(serializeExpense),
    incomes: incomes.map(serializeEntry),
  });
});

export default router;
