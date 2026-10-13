import type { NextFunction, Request, Response } from 'express';

import type { User } from '@/generated/prisma/client';
import { unauthorized } from '@/http/errors';
import { AUTH_COOKIE_NAME, toPublicUser, verifyAuthToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type TokenPayload = { userId: string; sessionVersion?: number };

export type RequireAuthDeps = {
  verifyToken: (token: string) => TokenPayload;
  findUser: (userId: string) => Promise<User | null>;
};

const defaultDeps: RequireAuthDeps = {
  verifyToken: verifyAuthToken,
  findUser: (userId) => prisma.user.findUnique({ where: { id: userId } }),
};

/**
 * Autentica pelo cookie JWT. Somente falhas do **token** (ausente, inválido,
 * expirado, sessão revogada) resultam em 401; erros de infraestrutura (ex.:
 * banco indisponível) seguem para o middleware de erro (5xx).
 */
export function createRequireAuth(deps: RequireAuthDeps = defaultDeps) {
  return async function requireAuth(
    req: Request,
    _res: Response,
    next: NextFunction,
  ) {
    const token: unknown = req.cookies?.[AUTH_COOKIE_NAME];
    if (!token || typeof token !== 'string') {
      next(unauthorized());
      return;
    }

    let payload: TokenPayload;
    try {
      payload = deps.verifyToken(token);
    } catch {
      next(unauthorized());
      return;
    }

    try {
      const user =
        typeof payload.userId === 'string'
          ? await deps.findUser(payload.userId)
          : null;

      if (!user || (payload.sessionVersion ?? 0) !== user.sessionVersion) {
        next(unauthorized());
        return;
      }

      req.user = toPublicUser(user, null);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAuth = createRequireAuth();
