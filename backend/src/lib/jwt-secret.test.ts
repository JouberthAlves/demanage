import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveJwtSecret } from '@/lib/jwt-secret';

test('requires a production JWT secret of at least 32 UTF-8 bytes', () => {
  assert.throws(() => resolveJwtSecret('too-short', 'production'), /32 bytes/);
  assert.equal(resolveJwtSecret('x'.repeat(32), 'production'), 'x'.repeat(32));
});

test('keeps the development-only fallback outside production', () => {
  assert.equal(resolveJwtSecret(undefined, 'development'), 'demanage-dev-secret');
});
