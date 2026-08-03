import 'module-alias/register';

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

if (NODE_ENV === 'production') {
  app.use(helmet());

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

app.set('trust proxy', 'loopback');
app.use(
  cors({
    origin: APP_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.use(cookieParser());
app.use(express.json());
app.use(requestLogger);
app.use(api);

httpServer.listen(API_PORT, () => {
  console.log(`deManage API running on ${API_PORT}`);
});
