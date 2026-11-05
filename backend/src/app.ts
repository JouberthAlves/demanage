import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { errorHandler, notFoundHandler } from '@/http/errors';
import { createLoginFailureLimiter } from '@/lib/login-failure-limiter';
import { isAllowedBrowserOrigin } from '@/lib/request-origin';
import { createMcpHttpRouter } from '@/mcp/http';
import { csrfProtection } from '@/middlewares/csrf-protection';
import { requestLogger } from '@/middlewares/request-logger';
import { startOAuthArtifactCleanup } from '@/oauth/cleanup';
import { getOAuthGrantSubject, oauthSettings } from '@/oauth/provider';
import api from '@/routes';
import { createOAuthDiscoveryRouter, createOAuthRouter } from '@/routes/oauth';
import { APP_URL, MCP_ENABLED, NODE_ENV } from '@/utils/var';

export type CreateAppOptions = {
  /** Loga cada requisição (padrão: `true`). */
  logRequests?: boolean;
};

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const AUTH_WRITE_PATHS = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/recovery-code',
  '/auth/recover-password',
  '/auth/trusted-device/enroll',
  '/auth/trusted-device/challenge',
  '/auth/trusted-device/login',
  '/auth/trusted-device/revoke',
]);

/** Browsing and reloading never consumes the mutation budget. The login/
 * recovery endpoints have their own stricter limiter below. */
export function skipGeneralMutationLimit(method: string, path: string) {
  const canonicalPath = path.replace(/\/+$/, '').toLowerCase();
  return ['GET', 'HEAD', 'OPTIONS'].includes(method) ||
    AUTH_WRITE_PATHS.has(canonicalPath);
}

/** Keep a much larger but finite read budget (behind shared Tunnel peers),
 * while never locking out health checks and auth session restoration. */
export function skipReadLimit(method: string, path: string) {
  const canonicalPath = path.replace(/\/+$/, '').toLowerCase();
  return !['GET', 'HEAD'].includes(method) ||
    canonicalPath === '/health' || canonicalPath === '/auth/me';
}

/** Monta a aplicação Express sem iniciar o servidor (`listen` fica em server.ts). */
export function createApp({ logRequests = true }: CreateAppOptions = {}) {
  const isProduction = NODE_ENV === 'production';
  const app = express();

  // Production accepts exactly one hop from frontend nginx. nginx replaces
  // incoming XFF with its sanitized socket peer (or a separately verified
  // Tunnel visitor IP). Never expose the backend directly: direct callers
  // could spoof that trusted forwarded hop and evade rate limiting.
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
        skip: (req) => skipGeneralMutationLimit(req.method, req.path),
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests. Please try again later.' },
      }),
    );
    app.use(rateLimit({
      windowMs: FIFTEEN_MINUTES_MS,
      limit: 1200,
      skip: (req) => skipReadLimit(req.method, req.path),
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Muitas consultas. Tente novamente em alguns minutos.' },
    }));
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
  // All authenticated unsafe requests pass through csrfProtection below.
  // codeql[js/missing-token-validation] Custom strict Origin/Referer CSRF protection.
  app.use(cookieParser());
  // Separate bearer-only MCP transport from the browser cookie/CSRF boundary.
  // The regular website routes retain their original CSRF protection.
  if (MCP_ENABLED) {
    const settings = oauthSettings();
    app.use(createMcpHttpRouter({
      verifyBearer: getOAuthGrantSubject,
      resourceUrl: settings.resource,
      issuerUrl: settings.issuer,
      isProduction,
    }));
  }
  app.use(csrfProtection);
  app.use(express.json({ limit: '256kb' }));

  if (MCP_ENABLED) {
    app.use(createOAuthDiscoveryRouter());
    app.use('/oauth', createOAuthRouter());
    // Keep the public token endpoint mounted at its advertised URL so
    // private_key_jwt audiences are verified against the public token path.
    app.use('/api/oauth', createOAuthRouter());
    startOAuthArtifactCleanup();
  }

  const authLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    max: isProduction ? 20 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Muitas tentativas. Tente novamente em alguns minutos.' },
  });
  for (const path of AUTH_WRITE_PATHS) {
    app.use(path, authLimiter);
  }
  app.post('/auth/login', createLoginFailureLimiter());

  app.use(api);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
