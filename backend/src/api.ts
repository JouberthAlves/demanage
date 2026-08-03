import { Router } from 'express';

import healthRoutes from './routes/health';

const api = Router();

api.use(healthRoutes);

export default api;
