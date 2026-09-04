import { Router } from 'express';

import deleteExpensesRouter from './[DELETE] - expenses';
import getExpensesRouter from './[GET] - expenses';
import patchExpensesRouter from './[PATCH] - expenses';
import postExpensesRouter from './[POST] - expenses';
import payExpenseRouter from './[POST] - pay';

const router = Router();

router.use('/', getExpensesRouter);
router.use('/', postExpensesRouter);
router.use('/', payExpenseRouter);
router.use('/', patchExpensesRouter);
router.use('/', deleteExpensesRouter);

export default router;
