import assert from 'node:assert/strict';
import test from 'node:test';

import { decimal } from '@/lib/decimal';
import {
  calculateCdiInterest,
  lastCompletedWeekday,
} from '@/lib/piggy-interest';

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

test('catch-up nunca depende do CDI do dia ainda em andamento', () => {
  assert.equal(
    lastCompletedWeekday(new Date('2026-08-21T18:00:00Z'))
      .toISOString()
      .slice(0, 10),
    '2026-08-20',
  );
});

test('fim de semana usa a sexta-feira como último dia concluído', () => {
  assert.equal(
    lastCompletedWeekday(new Date('2026-08-24T12:00:00Z'))
      .toISOString()
      .slice(0, 10),
    '2026-08-21',
  );
});
