import assert from 'node:assert/strict';
import test from 'node:test';

import { allocateByPercent, plainDecimal, sumMoney, toMoney } from '@/lib/money';

test('toMoney rounds half up to cents', () => {
  assert.equal(toMoney('0.145').toFixed(2), '0.15');
  assert.equal(toMoney('9.995').toFixed(2), '10.00');
  assert.equal(toMoney(1.005).toFixed(2), '1.01');
  assert.equal(toMoney('2.344').toFixed(2), '2.34');
});

test('sumMoney has no floating point drift', () => {
  assert.equal(sumMoney([0.1, 0.2]).toFixed(2), '0.30');
  assert.equal(sumMoney(Array.from({ length: 10 }, () => '0.1')).toFixed(2), '1.00');
  assert.equal(sumMoney([]).toFixed(2), '0.00');
});

test('allocateByPercent: R$19.99 at 50/50 is 10.00 + 9.99', () => {
  const parts = allocateByPercent(19.99, [50, 50]);
  assert.deepEqual(parts.map((part) => part.toFixed(2)), ['10.00', '9.99']);
});

test('allocateByPercent always sums to the total, to the cent', () => {
  let checked = 0;
  for (let cents = 1; cents <= 2000; cents += 1) {
    for (const first of [50, 33.33, 33.34, 12.5, 70, 99.99, 0.01]) {
      const total = cents / 100;
      const parts = allocateByPercent(total, [first, 100 - first]);
      const sum = parts.reduce((acc, part) => acc.plus(part), toMoney(0));
      assert.equal(sum.toFixed(2), toMoney(total).toFixed(2));
      assert.ok(parts.every((part) => part.decimalPlaces() <= 2));
      checked += 1;
    }
  }
  assert.ok(checked > 10_000);
});

test('allocateByPercent handles one and zero parts', () => {
  assert.deepEqual(allocateByPercent('10', [100]).map(String), ['10']);
  assert.deepEqual(allocateByPercent('10', []), []);
});

test('plainDecimal never emits exponent notation', () => {
  assert.equal(plainDecimal('0.000000000001'), '0.000000000001');
  assert.equal(plainDecimal(1e-12), '0.000000000001');
  assert.equal(plainDecimal('1.50'), '1.5');
});
