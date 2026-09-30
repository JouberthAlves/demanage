import type { RequestHandler } from 'express';

import {
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  revokeAuthToken,
} from '@/lib/auth';

type TokenRevoker = (token: string) => Promise<void>;

export function createLogoutHandler(
  revokeToken: TokenRevoker = revokeAuthToken,
): RequestHandler {
  return async (req, res) => {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (typeof token === 'string') {
      try {
        await revokeToken(token);
      } catch (error) {
        console.error(error);
        clearAuthCookie(res, req);
        return res.status(503).json({
          code: 'LOGOUT_REVOCATION_FAILED',
          error:
            'Esta sessão foi encerrada neste navegador, mas não foi possível encerrar as outras sessões',
        });
      }
    }

    clearAuthCookie(res, req);
    return res.json({ ok: true });
  };
}
