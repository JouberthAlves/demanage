import './register-aliases';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { createServer } from 'http';

import api from './api';
import { csrfProtection } from './middlewares/csrf-protection';
import { requestLogger } from './middlewares/request-logger';
import { isAllowedBrowserOrigin } from './lib/request-origin';
import { API_PORT, APP_URL, NODE_ENV } from './utils/var';

const app = express();
const httpServer = createServer(app);
if (NODE_ENV === 'production') {
  app.use(
    helmet({
      hsts: APP_URL?.startsWith('https://')
        ? { maxAge: 31_536_000 }
        : false,
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

app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  next();
});

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

      callback(null, isAllowedBrowserOrigin(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(cookieParser());
app.use(csrfProtection);
app.use(express.json({ limit: '256kb' }));
app.use(requestLogger);

app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);
app.use('/auth/recovery-code', authLimiter);
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

function onListen() {
  console.log(`deManage API running on ${API_PORT}`);
}

if (NODE_ENV === 'production') {
  httpServer.listen(Number(API_PORT), '::', onListen);
} else {
  httpServer.listen(API_PORT, onListen);
}
