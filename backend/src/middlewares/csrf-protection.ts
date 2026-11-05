import type { NextFunction, Request, Response } from 'express';

import { AUTH_COOKIE_NAME } from '@/lib/auth';
import { isAllowedBrowserOrigin } from '@/lib/request-origin';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type OriginValidator = (origin: string) => boolean;

function originFromRequest(req: Request) {
  const origin = req.get('origin');
  if (origin !== undefined) return origin;

  const referer = req.get('referer');
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/** Possession-cookie ceremonies require a trusted Origin even after logout,
 * when the session cookie is intentionally absent. No bearer-only exemption. */
export function strictBrowserOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = originFromRequest(req);
  if (origin && isAllowedBrowserOrigin(origin)) return next();
  return res.status(403).json({ error: 'Origem da requisição inválida' });
}

/** Browser requests creating a new session need an origin check even before
 * the auth cookie exists. Origin-less native JSON clients remain supported;
 * modern browsers that omit Origin still declare their Fetch Metadata site. */
export function sessionCreationOrigin(req: Request, res: Response, next: NextFunction) {
  if (req.get('origin') !== undefined || req.get('referer') !== undefined) {
    return strictBrowserOrigin(req, res, next);
  }

  const fetchSite = req.get('sec-fetch-site');
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return res.status(403).json({ error: 'Origem da requisição inválida' });
  }
  return next();
}

export function createCsrfProtection(
  isTrustedOrigin: OriginValidator = isAllowedBrowserOrigin,
) {
  return function csrfProtection(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (
      SAFE_METHODS.has(req.method.toUpperCase()) ||
      typeof token !== 'string' ||
      token.length === 0
    ) {
      return next();
    }

    const origin = originFromRequest(req);
    if (origin && isTrustedOrigin(origin)) return next();

    return res.status(403).json({ error: 'Origem da requisição inválida' });
  };
}

export const csrfProtection = createCsrfProtection();
