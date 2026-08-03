import { Router } from 'express';

import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import appsRoutes from './routes/app/apps/index';

const api = Router();

api.use(healthRoutes);
api.use(authRoutes);
api.use(appsRoutes);

export default api;
