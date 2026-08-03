import { Router } from 'express';

import cardsRouter from './cards/index';
import entriesRouter from './entries/index';
import expensesRouter from './expenses/index';

const router = Router();

router.use('/entries', entriesRouter);
router.use('/expenses', expensesRouter);
router.use('/cards', cardsRouter);

export default router;
