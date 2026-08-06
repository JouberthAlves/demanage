import { Router } from 'express';

import deleteCustomTagsRouter from './[DELETE] - custom-tags';
import getCustomTagsRouter from './[GET] - custom-tags';
import postCustomTagsRouter from './[POST] - custom-tags';

const router = Router();

router.use('/', getCustomTagsRouter);
router.use('/', postCustomTagsRouter);
router.use('/', deleteCustomTagsRouter);

export default router;
