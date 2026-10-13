import type { Request } from 'express';

import type { Asset } from '@/generated/prisma/client';
import { parseAbnt2Text } from '@/lib/abnt2';

import { badRequest, unauthorized } from './errors';

/**
 * Corpo JSON como objeto. `req.body` é `undefined` quando nenhum JSON é enviado
 * (Express 5), o que quebrava a desestruturação nos handlers.
 */
export function bodyOf(req: Request): Record<string, unknown> {
  const body: unknown = req.body;
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Corpo da requisição inválido');
  }
  return body as Record<string, unknown>;
}

/** Id do usuário autenticado por `requireAuth`. */
export function requireUserId(req: Request): string {
  const id = req.user?.id;
  if (!id) throw unauthorized();
  return id;
}

/** Parâmetro de rota como string (Express 5 tipa params como string). */
export function paramOf(req: Request, name = 'id'): string {
  return String(req.params[name]);
}

/** Query string simples; arrays/objetos (`?a=1&a=2`) são rejeitados. */
export function queryString(req: Request, name: string): string | undefined {
  const value: unknown = req.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw badRequest(`Parâmetro inválido: ${name}`);
  }
  return value;
}

/**
 * Booleano estrito. `undefined`/`null` → `undefined` (campo ausente);
 * aceita `true`/`false` e as strings "true"/"false". Qualquer outro valor é 400
 * (antes `Boolean("false") === true` ativava recursos silenciosamente).
 */
export function parseBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw badRequest(`Campo ${field} deve ser booleano`);
}

/**
 * Observação opcional: ausente/null/vazia → `null`; texto é sanitizado (ABNT2)
 * e truncado. Tipos que não são string são 400.
 */
export function parseOptionalNote(
  value: unknown,
  maxLength = 500,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('Observação inválida');
  return parseAbnt2Text(value, { maxLength }) || null;
}

/** Variante para PATCH: `undefined` (ausente) é preservado. */
export function parsePatchNote(
  value: unknown,
  maxLength = 500,
): string | null | undefined {
  return value === undefined ? undefined : parseOptionalNote(value, maxLength);
}

export function isAsset(value: unknown): value is Asset {
  return value === 'BTC' || value === 'USD';
}

/** `:asset` da rota (case-insensitive) → `BTC | USD` ou 400. */
export function parseAssetParam(req: Request, name = 'asset'): Asset {
  const value = paramOf(req, name).toUpperCase();
  if (!isAsset(value)) throw badRequest('Ativo inválido');
  return value;
}
