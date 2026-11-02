import { Router } from 'express';

import { requireUserId } from '@/http/request';
import { requireAuth } from '@/middlewares/require-auth';
import { serializeEntry } from '@/services/entries';
import { serializeExpense } from '@/services/expenses';
import {
  HistoryPageInputError,
  listFinancialHistoryPage,
  parseFinancialHistoryPageOptions,
} from '@/services/financial-history';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { expenses, incomes, snapshot, nextExpenseCursor, nextIncomeCursor } =
      await listFinancialHistoryPage(requireUserId(req), parseFinancialHistoryPageOptions(req.query));
    res.json({
      snapshot,
      nextExpenseCursor,
      nextIncomeCursor,
      expenses: expenses.map(serializeExpense),
      incomes: incomes.map(serializeEntry),
    });
  } catch (error) {
    if (error instanceof HistoryPageInputError) {
      res.status(400).json({ error: error.message });
      return;
    }
    throw error;
  }
});

export default router;
