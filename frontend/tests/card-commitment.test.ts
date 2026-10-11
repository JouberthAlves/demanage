import assert from 'node:assert/strict';
import test from 'node:test';

import { selectCardCommitments } from '@/lib/card-commitment';
import type { Card } from '@/types/finance';

function card(changes: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    name: 'Cartão',
    limit: 1000,
    committed: 0,
    available: 1000,
    ...changes,
  };
}

test('uses the committed amount computed by the backend', () => {
  const [item] = selectCardCommitments([
    card({ committed: 200, available: 800 }),
  ]);
  assert.equal(item?.committed, 200);
  assert.equal(item?.percent, 20);
});

test('percent may exceed 100 when committed is above the limit', () => {
  const [item] = selectCardCommitments([
    card({ committed: 1500, available: -500 }),
  ]);
  assert.equal(item?.percent, 150);
});

test('cards without a limit are skipped and the limit is never cast', () => {
  const result = selectCardCommitments([
    card({ limit: undefined, available: null }),
    card({ id: 'zero', limit: 0, available: 0 }),
  ]);
  assert.deepEqual(result, []);
});
