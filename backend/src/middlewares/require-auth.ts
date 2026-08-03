import type { NextFunction, Request, Response } from 'express';

import {
  AUTH_COOKIE_NAME,
  toPublicUser,
  verifyAuthToken,
} from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];

    if (!token || typeof token !== 'string') {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    const payload = verifyAuthToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      return res.status(401).json({ error: 'Não autenticado' });
    }

    req.user = toPublicUser(user);
    return next();
  } catch {
    return res.status(401).json({ error: 'Não autenticado' });
  }
}
