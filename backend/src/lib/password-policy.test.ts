import assert from 'node:assert/strict';
import test from 'node:test';

import { passwordPolicyError } from '@/lib/password-policy';

test('requires twelve characters for new passwords', () => {
  assert.match(passwordPolicyError('short') ?? '', /12 caracteres/);
  assert.equal(passwordPolicyError('correct horse'), null);
});

test('rejects passwords that exceed bcrypt UTF-8 byte limit', () => {
  assert.equal(passwordPolicyError('ã'.repeat(36)), null);
  assert.match(passwordPolicyError('ã'.repeat(37)) ?? '', /72 bytes/);
  assert.match(passwordPolicyError(123) ?? '', /inválida/);
});
