import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const INTENT_VERSION = 1;
const INTENT_LIFETIME_MS = 5 * 60_000;
const MAX_TOKEN_LENGTH = 8_192;
const TOKEN_PART = /^[A-Za-z0-9_-]+$/;

export type FinanceIntentIdentity = { userId: string; clientId: string };

type FinanceIntentEnvelope = FinanceIntentIdentity & {
  version: number;
  nonce: string;
  issuedAtMs: number;
  expiresAtMs: number;
  action: Record<string, unknown>;
};

function signature(encodedPayload: string, secret: string) {
  return createHmac('sha256', secret).update(encodedPayload).digest();
}

function checkSecret(secret: string) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Chave de assinatura financeira inválida');
  }
}

/** Pure preparation: no financial writes. Execute must revalidate all inputs. */
export function createSignedFinanceIntent(
  identity: FinanceIntentIdentity,
  action: Record<string, unknown>,
  secret: string,
  nowMs = Date.now(),
): { token: string; nonce: string } {
  checkSecret(secret);
  if (!identity.userId || !identity.clientId || !Number.isSafeInteger(nowMs)) {
    throw new Error('Identidade ou data do intent inválida');
  }
  const nonce = randomBytes(24).toString('base64url');
  const envelope: FinanceIntentEnvelope = {
    version: INTENT_VERSION,
    userId: identity.userId,
    clientId: identity.clientId,
    nonce,
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + INTENT_LIFETIME_MS,
    action,
  };
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
  const mac = signature(payload, secret).toString('base64url');
  const token = `${payload}.${mac}`;
  if (token.length > MAX_TOKEN_LENGTH) {
    throw new Error('Intent financeiro grande demais');
  }
  return { token, nonce };
}

/** Returns unknown action content; callers must use typed schema validation. */
export function verifySignedFinanceIntent(
  token: string,
  identity: FinanceIntentIdentity,
  secret: string,
  nowMs = Date.now(),
): { nonce: string; action: Record<string, unknown> } {
  checkSecret(secret);
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
    throw new Error('Intent financeiro inválido');
  }
  const parts = token.split('.');
  if (parts.length !== 2 || parts.some((part) => !TOKEN_PART.test(part))) {
    throw new Error('Intent financeiro inválido');
  }
  const [encodedPayload, encodedMac] = parts;
  const expectedMac = signature(encodedPayload, secret);
  const actualMac = Buffer.from(encodedMac, 'base64url');
  if (
    actualMac.length !== expectedMac.length ||
    !timingSafeEqual(expectedMac, actualMac)
  ) {
    throw new Error('Assinatura do intent financeiro inválida');
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Intent financeiro inválido');
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Intent financeiro inválido');
  }
  const data = envelope as Record<string, unknown>;
  if (
    data.version !== INTENT_VERSION ||
    typeof data.nonce !== 'string' ||
    !TOKEN_PART.test(data.nonce) ||
    !data.action ||
    typeof data.action !== 'object' ||
    Array.isArray(data.action) ||
    !Number.isSafeInteger(data.issuedAtMs) ||
    !Number.isSafeInteger(data.expiresAtMs) ||
    (data.expiresAtMs as number) - (data.issuedAtMs as number) !== INTENT_LIFETIME_MS ||
    !Number.isSafeInteger(nowMs)
  ) {
    throw new Error('Intent financeiro inválido');
  }
  if (data.userId !== identity.userId || data.clientId !== identity.clientId) {
    throw new Error('Identidade do intent financeiro inválida');
  }
  if (nowMs > (data.expiresAtMs as number)) {
    throw new Error('Intent financeiro expirado');
  }
  if (nowMs < (data.issuedAtMs as number) - 10_000) {
    throw new Error('Intent financeiro inválido');
  }
  return { nonce: data.nonce as string, action: data.action as Record<string, unknown> };
}
