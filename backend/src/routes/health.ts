import { Router } from 'express';

import { prisma } from '@/lib/prisma';

async function checkDatabaseConnection() {
  await prisma.$queryRaw`SELECT 1`;
}

/**
 * Liveness says only that the server process responds. Readiness is the
 * separate real database probe required by the release promotion gate.
 */
export function createHealthRoutes(
  checkReady: () => Promise<unknown> = checkDatabaseConnection,
) {
  const routes = Router();
  routes.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'demanage-backend',
      timestamp: new Date().toISOString(),
    });
  });
  routes.get('/ready', async (_req, res) => {
    try {
      await checkReady();
      res.json({ status: 'ok', service: 'demanage-backend', db: 'ready' });
    } catch {
      // Intentionally never leak DB host, query, password or driver details.
      res.status(503).json({
        status: 'unavailable',
        service: 'demanage-backend',
        db: 'unavailable',
      });
    }
  });
  return routes;
}

export default createHealthRoutes();
