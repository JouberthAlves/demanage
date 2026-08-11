import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const RECOVERY_CODE_LENGTH = 20;
const RECOVERY_GROUP_SIZE = 5;

export function generateRecoveryCode() {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let rawCode = '';

  for (const byte of bytes) {
    rawCode += RECOVERY_ALPHABET[byte & 31];
  }

  return (
    rawCode.match(new RegExp(`.{1,${RECOVERY_GROUP_SIZE}}`, 'g'))?.join('-') ??
    rawCode
  );
}

export function normalizeRecoveryCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string) {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

export function verifyRecoveryCode(code: string, expectedHash: string) {
  const actual = Buffer.from(hashRecoveryCode(code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
