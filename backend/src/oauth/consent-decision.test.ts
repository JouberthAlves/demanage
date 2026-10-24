import assert from 'node:assert/strict';
import test from 'node:test';

import { parseConsentDecision } from './consent-decision';

test('OAuth consent decision is only an explicit approve or deny choice', () => {
  assert.equal(parseConsentDecision('approve'), 'approve');
  assert.equal(parseConsentDecision('deny'), 'deny');
  for (const value of [
    null,
    undefined,
    '',
    'APPROVE',
    'true',
    'skip',
    1,
    {},
    ['approve'],
  ]) {
    assert.equal(parseConsentDecision(value), null);
  }
});
