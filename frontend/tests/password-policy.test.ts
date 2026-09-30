import assert from 'node:assert/strict';
import test from 'node:test';

import { passwordPolicyError } from '../src/lib/password-policy';

test('matches the minimum password length and bcrypt byte ceiling', () => {
  assert.match(passwordPolicyError('short') ?? '', /12 caracteres/);
  assert.equal(passwordPolicyError('correct horse'), null);
  assert.equal(passwordPolicyError('ã'.repeat(36)), null);
  assert.match(passwordPolicyError('ã'.repeat(37)) ?? '', /72 bytes/);
});
