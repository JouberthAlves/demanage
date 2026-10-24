import assert from 'node:assert/strict';
import test from 'node:test';

import type { ExpenseObligationVersion } from '@/generated/prisma/client';

import { legacyBaselineMonth, obligationSplitSnapshot, parseObligationVersions, scheduleMovesEarlier } from './obligation-versions';

function stored(splits: unknown): ExpenseObligationVersion {
  return {
    id: 'version-1', expenseId: 'expense-1', sequence: 1,
    effectiveMonth: '2026-08', amount: '100', cardId: null,
    splits, createdAt: new Date(),
  } as unknown as ExpenseObligationVersion;
}

test('F02: version snapshot freezes allocated cents and preserves the destination card', () => {
  const input = [
    { kind: 'card', cardId: 'card-a', amount: '60.00', percent: '60.00' },
    { kind: 'pix', cardId: null, amount: '40.00', percent: '40.00' },
  ];
  const snapshot = obligationSplitSnapshot(input);
  assert.deepEqual(snapshot, input);
  const [parsed] = parseObligationVersions([stored(snapshot)]);
  assert.deepEqual(parsed.splits, [
    { kind: 'card', cardId: 'card-a', amount: '60.00' },
    { kind: 'pix', cardId: null, amount: '40.00' },
  ]);
});

test('F02: malformed historical split must fail closed, never use a current price', () => {
  for (const splits of [
    [{ kind: 'card', cardId: 'card-a', amount: '101', percent: '100' }],
    [{ kind: 'card', cardId: null, amount: '100', percent: '100' }],
    [{ kind: 'pix', cardId: null, amount: '-100', percent: '100' }],
    { kind: 'card', amount: '100' },
  ]) {
    assert.throws(() => parseObligationVersions([stored(splits)]), /Invalid|match/);
  }
});

test('P1 Codex review: legacy baseline begins in first open-cycle obligation month, not edit month', () => {
  const at = (value: string) => new Date(`${value}T12:00:00.000Z`);
  assert.equal(legacyBaselineMonth(at('2026-01-01'), at('2025-12-01')), '2026-01');
  assert.equal(legacyBaselineMonth(null, at('2026-01-15')), '2026-01');
});

test('P2 Codex review: moving recurring startsAt earlier is a financial schedule backdate', () => {
  const at = (value: string) => new Date(`${value}T12:00:00.000Z`);
  assert.equal(scheduleMovesEarlier(at('2026-12-01'), at('2026-10-01')), true);
  assert.equal(scheduleMovesEarlier(at('2026-12-01'), at('2026-12-01')), false);
  assert.equal(scheduleMovesEarlier(at('2026-12-01'), at('2027-01-01')), false);
  assert.equal(scheduleMovesEarlier(at('2026-12-01'), undefined), false);
});