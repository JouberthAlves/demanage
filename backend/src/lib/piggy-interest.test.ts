import assert from 'node:assert/strict';
import test from 'node:test';

import { decimal } from '@/lib/decimal';
import {
  calculateCdiInterest,
  lastCompletedWeekday,
  splitCdiHistoryRange,
} from '@/lib/piggy-interest';
import {
  MAX_HISTORY_RANGE_DAYS,
  validateHistoryRange,
} from '@/lib/market-data';

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

test('catch-up divide histórico CDI longo em janelas compatíveis com o limite', () => {
  const ranges = splitCdiHistoryRange(
    new Date('2010-01-01T12:00:00.000Z'),
    new Date('2026-09-28T12:00:00.000Z'),
  );

  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].from, '2010-01-01');
  assert.equal(ranges.at(-1)?.to, '2026-09-28');
  for (const range of ranges) {
    const elapsedDays =
      (new Date(`${range.to}T12:00:00Z`).getTime() -
        new Date(`${range.from}T12:00:00Z`).getTime()) /
      86_400_000;
    assert.ok(elapsedDays + 1 <= MAX_HISTORY_RANGE_DAYS);
    assert.doesNotThrow(() =>
      validateHistoryRange(
        range.from,
        range.to,
        new Date('2026-09-29T12:00:00Z'),
      ),
    );
  }
});
