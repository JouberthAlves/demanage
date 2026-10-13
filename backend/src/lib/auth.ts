import bcrypt from 'bcryptjs';
import type { CookieOptions, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';

import type { User } from '@/generated/prisma/client';
import type { PublicUser } from '@/types/auth';
import {
  APP_URL,
  COOKIE_SAME_SITE,
  JWT_EXPIRES_IN,
  JWT_SECRET,
  NODE_ENV,
} from '@/utils/var';

export const AUTH_COOKIE_NAME = 'demanage-token';

export type { PublicUser };

type JwtPayload = {
  userId: string;
  sessionVersion?: number;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signAuthToken(userId: string, sessionVersion: number) {
  const options: SignOptions = {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };

  return jwt.sign(
    { userId, sessionVersion } satisfies JwtPayload,
    JWT_SECRET,
    options,
  );
}

export function verifyAuthToken(token: string) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as JwtPayload;
}

export async function revokeAuthToken(token: string) {
  let payload: JwtPayload;
  try {
    payload = verifyAuthToken(token);
  } catch {
    return;
  }

  if (
    typeof payload.userId !== 'string' ||
    !Number.isSafeInteger(payload.sessionVersion ?? 0)
  ) {
    return;
  }

  const { prisma } = await import('@/lib/prisma');
  await prisma.user.updateMany({
    where: {
      id: payload.userId,
      sessionVersion: payload.sessionVersion ?? 0,
    },
    data: { sessionVersion: { increment: 1 } },
  });
}

function resolveSameSite(req?: Request): 'lax' | 'none' {
  if (COOKIE_SAME_SITE === 'none' || COOKIE_SAME_SITE === 'lax') {
    return COOKIE_SAME_SITE;
  }

  if (NODE_ENV === 'production' && APP_URL && req) {
    try {
      const appHost = new URL(APP_URL).hostname;
      if (appHost && req.hostname && appHost !== req.hostname) {
        return 'none';
      }
    } catch {
      // APP_URL inválida: mantém lax
    }
  }

  return 'lax';
}

function jwtExpiresToMs(value: string) {
  const match = /^(\d+)\s*([smhd])$/i.exec(value.trim());
  if (!match) {
    return 7 * 24 * 60 * 60 * 1000;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * (multipliers[unit] ?? multipliers.d);
}

export function authCookieOptions(req?: Request): CookieOptions {
  const sameSite = resolveSameSite(req);
  const secure = sameSite === 'none' ? true : NODE_ENV === 'production';

  return {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
    maxAge: jwtExpiresToMs(JWT_EXPIRES_IN),
  };
}

export function setAuthCookie(res: Response, token: string, req?: Request) {
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions(req));
}

export function clearAuthCookie(res: Response, req?: Request) {
  const options = authCookieOptions(req);
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: options.httpOnly,
    sameSite: options.sameSite,
    secure: options.secure,
    path: options.path,
  });
}

export function toPublicUser(
  user: User,
  salaryReceiveDay: number | null = null,
): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    hasRecoveryCode: Boolean(user.recoveryCodeHash),
    salary: Number(user.salary),
    salaryReceiveDay,
    notes: user.notes,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function getSalaryReceiveDay(userId: string) {
  const { prisma } = await import('@/lib/prisma');
  const salaryEntry = await prisma.entry.findFirst({
    where: {
      userId,
      type: 'salario',
      frequency: 'mensal',
      name: 'Salário',
    },
    select: { receiveDay: true },
  });

  return salaryEntry?.receiveDay ?? null;
}
