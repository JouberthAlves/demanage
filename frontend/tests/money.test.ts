import assert from 'node:assert/strict';
import test from 'node:test';

import { maxChargesPerCycle } from '@/lib/billing';
import { computeSplitShares } from '@/lib/expense-card-limit';
import { allocateCentsByPercent, toCents } from '@/lib/money';

test('R$ 0,29 at 50/50 gives 0,15 + 0,14 (HALF_UP, remainder last)', () => {
  const shares = computeSplitShares(0.29, '50');
  assert.equal(shares.share1, 0.15);
  assert.equal(shares.share2, 0.14);
});

test('R$ 19,99 at 50/50 gives 10,00 + 9,99', () => {
  const shares = computeSplitShares(19.99, '50');
  assert.equal(shares.share1, 10);
  assert.equal(shares.share2, 9.99);
  assert.equal(shares.percent2, 50);
});

test('an invalid percent puts everything on the second part', () => {
  const shares = computeSplitShares(10, '');
  assert.equal(shares.percent1, null);
  assert.equal(shares.share1, 0);
  assert.equal(shares.share2, 10);
});

test('parts always sum to the total for every cent total and percent', () => {
  for (let total = 1; total <= 20000; total += 1) {
    for (let percent = 1; percent <= 99; percent += 1) {
      const [first = NaN, last = NaN] = allocateCentsByPercent(total, [
        percent,
        100 - percent,
      ]);
      assert.equal(first + last, total, `${total} @ ${percent}%`);
      assert.ok(first >= 0 && last >= 0, `${total} @ ${percent}%`);
    }
  }
});

test('computeSplitShares matches the cents allocation for amounts', () => {
  for (let cents = 1; cents <= 20000; cents += 7) {
    for (const percent of [1, 33, 50, 67, 99]) {
      const shares = computeSplitShares(cents / 100, String(percent));
      assert.equal(
        toCents(shares.share1) + toCents(shares.share2),
        cents,
        `${cents} @ ${percent}%`,
      );
    }
  }
});

test('maxChargesPerCycle: uses the card value, falls back to a normal cycle', () => {
  const plain = {};
  assert.equal(maxChargesPerCycle(plain, 'semanal'), 5);
  assert.equal(maxChargesPerCycle(plain, 'mensal'), 1);
  assert.equal(maxChargesPerCycle(plain, 'unica'), 1);
  const long = {
    maxChargesPerCycle: { unica: 1, mensal: 2, semanal: 9 },
  };
  assert.equal(maxChargesPerCycle(long, 'mensal'), 2);
  assert.equal(maxChargesPerCycle(long, 'semanal'), 9);
});
