import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';

import { AppError, badRequest, conflict, unauthorized } from '@/http/errors';
import { AUTH_COOKIE_NAME, authCookieOptions, comparePassword, verifyAuthToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { JWT_SECRET, NODE_ENV } from '@/utils/var';

/** Independent opt-in browser possession factor; never a password-only escape. */
export const TRUSTED_DEVICE_COOKIE_NAME = NODE_ENV === 'production'
  ? '__Host-demanage-trusted-device'
  : 'demanage-trusted-device';
const DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 3 * 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const FAILURE_LIMIT = 5;
const MAX_DEVICES = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SECRET = /^[A-Za-z0-9_-]{43}$/u;
const INVALID = 'E-mail ou senha inválidos';
const LIMIT = 'Muitas tentativas. Tente novamente em alguns minutos.';

function reproofWindow(user: { trustedProofWindowAt: Date | null; trustedProofFailures: number }) {
  return Boolean(user.trustedProofWindowAt &&
    user.trustedProofWindowAt.getTime() + FAILURE_WINDOW_MS > Date.now());
}

type ReproofOutcome<T> = { kind: 'ok'; value: T } | { kind: 'denied' } | { kind: 'limited' };

function rejectReproof(kind: 'denied' | 'limited'): never {
  if (kind === 'limited') throw new AppError(429, LIMIT);
  throw unauthorized('Senha atual inválida');
}

function digest(domain: string, input: string) {
  return createHmac('sha256', JWT_SECRET).update(`${domain}\0${input}`).digest('hex');
}

function tokenOf(req: Request) {
  const raw = req.cookies?.[TRUSTED_DEVICE_COOKIE_NAME];
  if (typeof raw !== 'string' || raw.length !== 80) return null;
  const [id, secret, extra] = raw.split('.');
  if (extra !== undefined || !id || !secret || !UUID.test(id) || !SECRET.test(secret)) return null;
  return { id, secretHash: digest('trusted-device-v1', secret) };
}

function sameHash(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/u.test(left) || !/^[a-f0-9]{64}$/u.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function trustedDeviceCookieOptions(req?: Request) {
  return { ...authCookieOptions(req), path: '/' as const,
    secure: NODE_ENV === 'production' || authCookieOptions(req).secure,
    maxAge: DEVICE_TTL_MS };
}

export function clearTrustedDeviceCookie(res: Response, req?: Request) {
  const options = trustedDeviceCookieOptions(req);
  res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, {
    httpOnly: options.httpOnly, secure: options.secure,
    sameSite: options.sameSite, path: options.path,
  });
}

function validDevice(device: {
  secretHash: string; credentialVersion: number; revokedAt: Date | null;
  expiresAt: Date; user: { trustedDeviceVersion: number };
}, hash: string, now: Date) {
  return sameHash(device.secretHash, hash) && !device.revokedAt &&
    device.expiresAt > now && device.credentialVersion === device.user.trustedDeviceVersion;
}

/** Enrollment requires both a live cookie session and fresh password proof. */
export async function enrollTrustedDevice(req: Request) {
  const currentPassword = req.body?.currentPassword;
  const label = req.body?.label ?? 'Dispositivo confiável';
  if (typeof currentPassword !== 'string' || !currentPassword ||
      typeof label !== 'string' || !label.trim() || label.length > 80 ||
      [...label].some((character) => character.charCodeAt(0) < 32 ||
        character.charCodeAt(0) === 127)) throw badRequest('Dados de dispositivo inválidos');

  const userId = req.user?.id;
  const jwt = req.cookies?.[AUTH_COOKIE_NAME];
  if (!userId || typeof jwt !== 'string') throw unauthorized();
  const payload = verifyAuthToken(jwt);
  if (payload.userId !== userId || !Number.isSafeInteger(payload.sessionVersion)) throw unauthorized();
  const secret = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEVICE_TTL_MS);
  const result = await prisma.$transaction(async (tx): Promise<ReproofOutcome<{
    id: string; label: string;
  }>> => {
    // Serialize with password recovery and with competing enrollments.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.sessionVersion !== payload.sessionVersion) return { kind: 'denied' };
    const windowLive = reproofWindow(user);
    if (windowLive && user.trustedProofFailures >= FAILURE_LIMIT) return { kind: 'limited' };
    if (!(await comparePassword(currentPassword, user.passwordHash))) {
      await tx.user.update({ where: { id: userId }, data: {
        trustedProofFailures: windowLive ? user.trustedProofFailures + 1 : 1,
        trustedProofWindowAt: windowLive ? user.trustedProofWindowAt : new Date(),
      } });
      return { kind: 'denied' };
    }
    if (user.trustedProofFailures) await tx.user.update({ where: { id: userId },
      data: { trustedProofFailures: 0, trustedProofWindowAt: null } });
    const count = await tx.trustedLoginDevice.count({ where: {
      userId, revokedAt: null, expiresAt: { gt: now },
      credentialVersion: user.trustedDeviceVersion,
    } });
    if (count >= MAX_DEVICES) throw conflict('Limite de dispositivos confiáveis atingido');
    const device = await tx.trustedLoginDevice.create({ data: {
      userId, label: label.trim(), secretHash: digest('trusted-device-v1', secret),
      credentialVersion: user.trustedDeviceVersion, expiresAt,
    } });
    return { kind: 'ok', value: { id: device.id, label: device.label } };
  }, { maxWait: 5_000, timeout: 15_000 });

  if (result.kind !== 'ok') return rejectReproof(result.kind);
  return { ...result.value, expiresAt, cookie: `${result.value.id}.${secret}` };
}

export async function listTrustedDevices(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId },
    select: { trustedDeviceVersion: true } });
  return prisma.trustedLoginDevice.findMany({ where: {
    userId, credentialVersion: user.trustedDeviceVersion,
    revokedAt: null, expiresAt: { gt: new Date() },
  }, select: { id: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true },
  orderBy: { createdAt: 'desc' } });
}

/** Explicit revoke does not silently erase unrelated sessions or trusted devices. */
export async function revokeTrustedDevice(req: Request) {
  const id = req.body?.deviceId;
  const currentPassword = req.body?.currentPassword;
  const userId = req.user?.id;
  if (!userId || typeof id !== 'string' || !UUID.test(id) ||
      typeof currentPassword !== 'string' || !currentPassword) {
    throw badRequest('Dados de dispositivo inválidos');
  }
  const result = await prisma.$transaction(async (tx): Promise<ReproofOutcome<boolean>> => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return { kind: 'denied' };
    const windowLive = reproofWindow(user);
    if (windowLive && user.trustedProofFailures >= FAILURE_LIMIT) return { kind: 'limited' };
    if (!(await comparePassword(currentPassword, user.passwordHash))) {
      await tx.user.update({ where: { id: userId }, data: {
        trustedProofFailures: windowLive ? user.trustedProofFailures + 1 : 1,
        trustedProofWindowAt: windowLive ? user.trustedProofWindowAt : new Date(),
      } });
      return { kind: 'denied' };
    }
    if (user.trustedProofFailures) await tx.user.update({ where: { id: userId },
      data: { trustedProofFailures: 0, trustedProofWindowAt: null } });
    await tx.trustedLoginDevice.updateMany({ where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() } });
    return { kind: 'ok', value: tokenOf(req)?.id === id };
  }, { maxWait: 5_000, timeout: 15_000 });
  if (result.kind !== 'ok') return rejectReproof(result.kind);
  return result.value;
}

/** Uniform response for absent/unknown/revoked devices; none reveals a user. */
export async function beginTrustedDeviceChallenge(req: Request) {
  const id = randomUUID();
  const nonce = randomBytes(32).toString('base64url');
  const token = tokenOf(req);
  if (token) {
    await prisma.$transaction(async (tx) => {
      // Device-local row lock: only three outstanding ceremonies can exist.
      // Never scan/delete all users' challenge rows on an untrusted request.
      await tx.$queryRaw`SELECT "id" FROM "TrustedLoginDevice" WHERE "id" = ${token.id} FOR UPDATE`;
      const now = new Date();
      const device = await tx.trustedLoginDevice.findUnique({ where: { id: token.id },
        include: { user: { select: { trustedDeviceVersion: true } } } });
      if (!device || !validDevice(device, token.secretHash, now)) return;
      await tx.trustedLoginChallenge.deleteMany({ where: {
        deviceId: device.id,
        OR: [{ usedAt: { not: null } }, { expiresAt: { lte: now } }],
      } });
      const live = await tx.trustedLoginChallenge.count({ where: {
        deviceId: device.id, usedAt: null, expiresAt: { gt: now },
      } });
      if (live >= 3) return;
      await tx.trustedLoginChallenge.create({ data: {
        id, deviceId: device.id, proofHash: digest('trusted-challenge-v1', nonce),
        expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
      } });
    }, { maxWait: 5_000, timeout: 10_000 });
  }
  return { challengeId: id, nonce, expiresIn: CHALLENGE_TTL_MS / 1000 };
}

type LoginResult = { kind: 'ok'; userId: string; sessionVersion: number } |
  { kind: 'denied' } | { kind: 'limited' };

/** Single-use challenge + cookie possession + password under a locked per-device budget. */
export async function authenticateTrustedDevice(req: Request): Promise<LoginResult> {
  const token = tokenOf(req);
  const { email, password, challengeId, nonce } = req.body ?? {};
  if (!token || typeof email !== 'string' || typeof password !== 'string' ||
      typeof challengeId !== 'string' || typeof nonce !== 'string' ||
      !UUID.test(challengeId) || !SECRET.test(nonce) ||
      email.length > 254 || !password || password.length > 1024) return { kind: 'denied' };

  const now = new Date();
  const device = await prisma.trustedLoginDevice.findUnique({ where: { id: token.id },
    include: { user: true } });
  if (!device || !validDevice(device, token.secretHash, now)) return { kind: 'denied' };
  // Burn first; even failed password guesses cannot replay the same ceremony.
  const claimed = await prisma.trustedLoginChallenge.updateMany({ where: {
    id: challengeId, deviceId: device.id,
    proofHash: digest('trusted-challenge-v1', nonce),
    usedAt: null, expiresAt: { gt: now },
  }, data: { usedAt: now } });
  if (claimed.count !== 1) return { kind: 'denied' };

  return prisma.$transaction(async (tx): Promise<LoginResult> => {
    // PostgreSQL row lock gives the failed-password quota a single total order
    // across simultaneous requests and different source IPs.
    await tx.$queryRaw`SELECT "id" FROM "TrustedLoginDevice" WHERE "id" = ${device.id} FOR UPDATE`;
    const current = await tx.trustedLoginDevice.findUnique({ where: { id: device.id },
      include: { user: true } });
    if (!current || !validDevice(current, token.secretHash, new Date())) return { kind: 'denied' };
    const windowLive = current.failedWindowStartedAt &&
      current.failedWindowStartedAt.getTime() + FAILURE_WINDOW_MS > Date.now();
    if (windowLive && current.failedAttempts >= FAILURE_LIMIT) return { kind: 'limited' };
    // Always perform the password comparison, even when the supplied email
    // differs, so no account-discovery timing shortcut exists for a device.
    const passwordMatches = await comparePassword(password, current.user.passwordHash);
    const matches = current.user.email === email.trim().toLowerCase() && passwordMatches;
    if (!matches) {
      await tx.trustedLoginDevice.update({ where: { id: current.id }, data: {
        failedAttempts: windowLive ? current.failedAttempts + 1 : 1,
        failedWindowStartedAt: windowLive ? current.failedWindowStartedAt : new Date(),
      } });
      return { kind: 'denied' };
    }
    await tx.trustedLoginDevice.update({ where: { id: current.id }, data: {
      lastUsedAt: new Date(), failedAttempts: 0, failedWindowStartedAt: null,
    } });
    return { kind: 'ok', userId: current.userId, sessionVersion: current.user.sessionVersion };
  }, { maxWait: 5_000, timeout: 15_000 });
}

export function denyTrustedLogin(kind: Exclude<LoginResult['kind'], 'ok'>): never {
  if (kind === 'limited') throw new AppError(429, LIMIT);
  throw unauthorized(INVALID);
}
