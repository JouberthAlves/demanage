import { Router } from 'express';

import cardsRouter from './cards/index';
import customTagsRouter from './custom-tags/index';
import entriesRouter from './entries/index';
import expensesRouter from './expenses/index';

const router = Router();

router.use('/entries', entriesRouter);
router.use('/expenses', expensesRouter);
router.use('/cards', cardsRouter);
router.use('/custom-tags', customTagsRouter);

export default router;
