import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeLogValue } from '@/middlewares/request-logger';

test('log values cannot inject lines, terminal controls, or unbounded text', () => {
  assert.equal(
    sanitizeLogValue('path\r\nforged\u001b[31m'),
    'path??forged?[31m',
  );
  assert.equal(sanitizeLogValue('x'.repeat(10), 4), 'xxxx');
});
