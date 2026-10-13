import { Router } from 'express';

import assetsRoutes from './assets';
import authRoutes from './auth';
import cardsRoutes from './cards';
import customTagsRoutes from './custom-tags';
import entriesRoutes from './entries';
import expensesRoutes from './expenses';
import healthRoutes from './health';
import jobsRoutes from './jobs';
import marketRoutes from './market';
import patrimonyRoutes from './patrimony';
import piggyBanksRoutes from './piggy-banks';

const api = Router();

api.use(healthRoutes);
api.use(authRoutes);
api.use(jobsRoutes);
api.use('/entries', entriesRoutes);
api.use('/expenses', expensesRoutes);
api.use('/cards', cardsRoutes);
api.use('/custom-tags', customTagsRoutes);
api.use('/piggy-banks', piggyBanksRoutes);
api.use('/market', marketRoutes);
api.use('/assets', assetsRoutes);
api.use('/patrimony', patrimonyRoutes);

export default api;
