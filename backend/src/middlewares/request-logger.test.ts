import assert from 'node:assert/strict';
import test from 'node:test';

import { formatLogLine, sanitizeLogValue } from '@/middlewares/request-logger';

test('log values cannot inject lines, terminal controls, or unbounded text', () => {
  assert.equal(
    sanitizeLogValue('path\r\nforged\u001b[31m'),
    'path??forged?[31m',
  );
  assert.equal(sanitizeLogValue('x'.repeat(10), 4), 'xxxx');
});

test('log lines are plain text without chalk and colored status is optional', () => {
  const line = formatLogLine(
    {
      time: '10:00:00,000',
      ip: '127.0.0.1',
      method: 'GET',
      url: '/health',
      status: 503,
      durationMs: '1.23',
    },
    null,
  );
  assert.equal(line, '10:00:00,000 127.0.0.1 - GET /health 503 - 1.23ms');
});
