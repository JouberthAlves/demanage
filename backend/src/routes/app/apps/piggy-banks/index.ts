import { Router } from 'express';

import archiveRouter from './[POST] - archive';
import deleteRouter from './[DELETE] - piggy-banks';
import depositRouter from './[POST] - deposit';
import getRouter from './[GET] - piggy-banks';
import patchRouter from './[PATCH] - piggy-banks';
import postRouter from './[POST] - piggy-banks';
import processAutoDebitRouter from './[POST] - process-auto-debit';
import withdrawRouter from './[POST] - withdraw';

const router = Router();

router.use('/', processAutoDebitRouter);
router.use('/', getRouter);
router.use('/', postRouter);
router.use('/', depositRouter);
router.use('/', withdrawRouter);
router.use('/', archiveRouter);
router.use('/', patchRouter);
router.use('/', deleteRouter);

export default router;
