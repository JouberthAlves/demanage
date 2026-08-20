import './register-aliases';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createServer } from 'http';

import api from './api';
import { requestLogger } from './middlewares/request-logger';
import { API_PORT, APP_URL, NODE_ENV } from './utils/var';

const app = express();
const httpServer = createServer(app);
const normalizedAppOrigin = APP_URL?.replace(/\/$/, '');

function isLoopbackHostname(hostname: string) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function isPrivateIpv4Hostname(hostname: string) {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isDevelopmentBrowserOrigin(origin: string) {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    return (
      isLoopbackHostname(url.hostname) ||
      isPrivateIpv4Hostname(url.hostname) ||
      url.hostname.endsWith('.local')
    );
  } catch {
    return false;
  }
}

if (NODE_ENV === 'production') {
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'Too many requests. Please try again later.',
    },
  });
  app.use(limiter);
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: NODE_ENV === 'production' ? 20 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas tentativas. Tente novamente em alguns minutos.',
  },
});

app.set('trust proxy', NODE_ENV === 'production' ? 1 : 'loopback');
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = origin.replace(/\/$/, '');
      const allowed =
        normalizedOrigin === normalizedAppOrigin ||
        (NODE_ENV !== 'production' &&
          isDevelopmentBrowserOrigin(normalizedOrigin));

      callback(null, allowed);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.use(cookieParser());
app.use(express.json({ limit: '256kb' }));
app.use(requestLogger);

app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/auth/recover-password', authLimiter);
app.use(api);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  },
);

httpServer.listen(API_PORT, () => {
  console.log(`deManage API running on ${API_PORT}`);
});
