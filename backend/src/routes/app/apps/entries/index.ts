import { Router } from 'express';

import deleteEntriesRouter from './[DELETE] - entries';
import getEntriesRouter from './[GET] - entries';
import patchEntriesRouter from './[PATCH] - entries';
import postEntriesRouter from './[POST] - entries';

const router = Router();

router.use('/', getEntriesRouter);
router.use('/', postEntriesRouter);
router.use('/', patchEntriesRouter);
router.use('/', deleteEntriesRouter);

export default router;
