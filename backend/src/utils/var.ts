import '@/config/env';

function requireInProduction(name: string, value: string | undefined) {
  if (process.env.NODE_ENV === 'production' && !value?.trim()) {
    throw new Error(
      `[deManage] Missing required env in production: ${name}`,
    );
  }
  return value;
}

export const NODE_ENV = process.env.NODE_ENV;
/** Prefer platform `PORT` (Railway/Docker), then `API_PORT`, then 8888. */
export const API_PORT = process.env.PORT ?? process.env.API_PORT ?? '8888';
export const APP_URL = requireInProduction('APP_URL', process.env.APP_URL);

requireInProduction('DATABASE_URL', process.env.DATABASE_URL);

const jwtSecret = requireInProduction('JWT_SECRET', process.env.JWT_SECRET);
export const JWT_SECRET =
  jwtSecret?.trim() ||
  (NODE_ENV === 'production'
    ? (() => {
        throw new Error(
          '[deManage] Missing required env in production: JWT_SECRET',
        );
      })()
    : 'demanage-dev-secret');

export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN ?? '7d';

/** Override: `lax` | `none`. Empty = auto (none when FE host ≠ API host in prod). */
export const COOKIE_SAME_SITE = process.env.COOKIE_SAME_SITE?.toLowerCase();
