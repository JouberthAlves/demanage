import assert from 'node:assert/strict';
import test from 'node:test';

import { patrimonyToday } from '@/lib/patrimony';

test('patrimony current-day boundary follows the São Paulo civil day', () => {
  assert.equal(
    patrimonyToday(new Date('2026-10-01T01:00:00.000Z'))
      .toISOString()
      .slice(0, 10),
    '2026-09-30',
  );
});
