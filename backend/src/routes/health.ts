import { Router } from 'express';

const healthRoutes = Router();

healthRoutes.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'demanage-backend',
    timestamp: new Date().toISOString(),
  });
});

export default healthRoutes;
