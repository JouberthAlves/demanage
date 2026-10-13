import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { errorHandler, notFoundHandler } from '@/http/errors';
import { isAllowedBrowserOrigin } from '@/lib/request-origin';
import { csrfProtection } from '@/middlewares/csrf-protection';
import { requestLogger } from '@/middlewares/request-logger';
import api from '@/routes';
import { APP_URL, NODE_ENV } from '@/utils/var';

export type CreateAppOptions = {
  /** Loga cada requisição (padrão: `true`). */
  logRequests?: boolean;
};

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/** Monta a aplicação Express sem iniciar o servidor (`listen` fica em server.ts). */
export function createApp({ logRequests = true }: CreateAppOptions = {}) {
  const isProduction = NODE_ENV === 'production';
  const app = express();

  app.set('trust proxy', isProduction ? 1 : 'loopback');

  if (isProduction) {
    app.use(
      helmet({
        hsts: APP_URL?.startsWith('https://') ? { maxAge: 31_536_000 } : false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
      }),
    );
    app.use(
      rateLimit({
        windowMs: FIFTEEN_MINUTES_MS,
        max: 100,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests. Please try again later.' },
      }),
    );
  }

  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), geolocation=(), microphone=()',
    );
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        callback(null, isAllowedBrowserOrigin(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  if (logRequests) app.use(requestLogger);
  app.use(cookieParser());
  app.use(csrfProtection);
  app.use(express.json({ limit: '256kb' }));

  const authLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    max: isProduction ? 20 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
  });
  for (const path of [
    '/auth/login',
    '/auth/register',
    '/auth/recovery-code',
    '/auth/recover-password',
  ]) {
    app.use(path, authLimiter);
  }

  app.use(api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
