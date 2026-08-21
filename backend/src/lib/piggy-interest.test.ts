import assert from 'node:assert/strict';
import test from 'node:test';

import { decimal } from '@/lib/decimal';
import { calculateCdiInterest } from '@/lib/piggy-interest';

test('rendimento diário usa CDI bruto proporcional ao percentual do cofrinho', () => {
  const interest = calculateCdiInterest(
    decimal('10000'),
    decimal('0.04'),
    decimal('100'),
  );
  assert.equal(interest.toFixed(2), '4.00');
});

test('cofrinho 120% CDI multiplica a taxa diária sem aplicar imposto', () => {
  const interest = calculateCdiInterest(
    decimal('10000'),
    decimal('0.04'),
    decimal('120'),
  );
  assert.equal(interest.toFixed(2), '4.80');
});

test('percentual zero não inventa rendimento', () => {
  const interest = calculateCdiInterest(
    decimal('10000'),
    decimal('0.04'),
    decimal('0'),
  );
  assert.equal(interest.toFixed(2), '0.00');
});
