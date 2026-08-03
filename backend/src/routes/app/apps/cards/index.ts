import { Router } from 'express';

import deleteCardsRouter from './[DELETE] - cards';
import getCardsRouter from './[GET] - cards';
import patchCardsRouter from './[PATCH] - cards';
import postCardsRouter from './[POST] - cards';

const router = Router();

router.use('/', getCardsRouter);
router.use('/', postCardsRouter);
router.use('/', patchCardsRouter);
router.use('/', deleteCardsRouter);

export default router;
