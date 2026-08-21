import { Router } from 'express';

import assetsRouter from './assets/index';
import cardsRouter from './cards/index';
import customTagsRouter from './custom-tags/index';
import entriesRouter from './entries/index';
import expensesRouter from './expenses/index';
import marketRouter from './market/index';
import patrimonyRouter from './patrimony/index';
import piggyBanksRouter from './piggy-banks/index';

const router = Router();

router.use('/entries', entriesRouter);
router.use('/expenses', expensesRouter);
router.use('/cards', cardsRouter);
router.use('/custom-tags', customTagsRouter);
router.use('/piggy-banks', piggyBanksRouter);
router.use('/market', marketRouter);
router.use('/assets', assetsRouter);
router.use('/patrimony', patrimonyRouter);

export default router;
