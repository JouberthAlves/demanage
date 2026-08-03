import type { User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { CookieOptions, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';

import type { PublicUser } from '@/types/auth';
import { JWT_EXPIRES_IN, JWT_SECRET, NODE_ENV } from '@/utils/var';

export const AUTH_COOKIE_NAME = 'demanage-token';

export type { PublicUser };

type JwtPayload = {
  userId: string;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function signAuthToken(userId: string) {
  const options: SignOptions = {
    expiresIn: JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };

  return jwt.sign({ userId } satisfies JwtPayload, JWT_SECRET, options);
}

export function verifyAuthToken(token: string) {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export function authCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: NODE_ENV === 'production',
    path: '/',
  });
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    salary: Number(user.salary),
    notes: user.notes,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
