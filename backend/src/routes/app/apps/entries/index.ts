import { Router } from 'express';

import deleteEntriesRouter from './[DELETE] - entries';
import getEntriesRouter from './[GET] - entries';
import patchEntriesRouter from './[PATCH] - entries';
import postEntriesRouter from './[POST] - entries';
import receiptStateRouter from './[POST] - receipt-state';

const router = Router();

router.use('/', getEntriesRouter);
router.use('/', postEntriesRouter);
router.use('/', receiptStateRouter);
router.use('/', patchEntriesRouter);
router.use('/', deleteEntriesRouter);

export default router;
