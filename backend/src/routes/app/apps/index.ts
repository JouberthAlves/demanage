import { Router } from 'express';

import cardsRouter from './cards/index';
import customTagsRouter from './custom-tags/index';
import entriesRouter from './entries/index';
import expensesRouter from './expenses/index';
import piggyBanksRouter from './piggy-banks/index';

const router = Router();

router.use('/entries', entriesRouter);
router.use('/expenses', expensesRouter);
router.use('/cards', cardsRouter);
router.use('/custom-tags', customTagsRouter);
router.use('/piggy-banks', piggyBanksRouter);

export default router;
