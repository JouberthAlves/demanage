import { createHmac } from 'node:crypto';
import rateLimit from 'express-rate-limit';

import { JWT_SECRET } from '@/utils/var';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const FAILED_LOGIN_LIMIT = 10;
const LIMIT_MESSAGE = {
  error: 'Muitas tentativas. Tente novamente em alguns minutos.',
};

function loginIdentifier(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string' || !password) {
    return null;
  }
  return email.trim().toLowerCase() || null;
}

/**
 * Complements (never replaces) the IP limiter. The canonical identifier gets
 * the same failure budget across different remote IPs, including nonexistent
 * users, so the limiter cannot be used to enumerate registered accounts.
 * The production Compose runs one backend; MemoryStore is per process.
 */
export function createLoginFailureLimiter({
  windowMs = FIFTEEN_MINUTES_MS,
  limit = FAILED_LOGIN_LIMIT,
}: { windowMs?: number; limit?: number } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: false,
    legacyHeaders: false,
    skip: (req) => loginIdentifier(req.body) === null,
    keyGenerator: (req) =>
      createHmac('sha256', JWT_SECRET)
        .update(loginIdentifier(req.body)!)
        .digest('hex'),
    skipSuccessfulRequests: true,
    // Count authentication failures only, not JSON validation or backend 5xx.
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    message: LIMIT_MESSAGE,
  });
}
