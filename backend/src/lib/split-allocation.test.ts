import assert from 'node:assert/strict';
import test from 'node:test';

import type { Card } from '@/generated/prisma/client';
import { DomainError } from '@/lib/errors';
import {
  allocateSplitAmounts,
  assertCardLimits,
  ExpenseSplitError,
  validateSplitShape,
} from '@/lib/split-allocation';

const parts = (first: number) =>
  [
    { kind: 'card', cardId: 'c1', percent: first },
    { kind: 'pix', cardId: null, percent: 100 - first },
  ] as const;

test('R$19.99 at 50/50 allocates 10.00 + 9.99 (float math gave 9.99 + 10.00 off by a cent)', () => {
  const result = allocateSplitAmounts(19.99, [...parts(50)]);
  assert.deepEqual(result.map((part) => part.amount), [10, 9.99]);
});

test('allocation always sums to the total (exhaustive over 2000 totals x 7 percents)', () => {
  for (let cents = 1; cents <= 2000; cents += 1) {
    for (const first of [50, 33.33, 33.34, 12.5, 70, 99.99, 0.01]) {
      const total = cents / 100;
      const result = allocateSplitAmounts(total, [...parts(first)]);
      const sumCents = result.reduce((sum, part) => sum + Math.round(part.amount * 100), 0);
      assert.equal(sumCents, cents, `${total} @ ${first}`);
    }
  }
});

test('expense split errors are DomainErrors with a stable code', () => {
  const error = new ExpenseSplitError('x');
  assert.ok(error instanceof DomainError);
  assert.equal(error.code, 'EXPENSE_SPLIT_INVALID');
  assert.equal(error.name, 'ExpenseSplitError');
});

test('split shape validation keeps its rules', () => {
  assert.throws(() => validateSplitShape([{ kind: 'pix', percent: 100 }]), /PIX 100%/);
  assert.throws(
    () =>
      validateSplitShape([
        { kind: 'card', cardId: 'a', percent: 60 },
        { kind: 'pix', percent: 30 },
      ]),
    /100%/,
  );
  assert.doesNotThrow(() =>
    validateSplitShape([
      { kind: 'card', cardId: 'a', percent: 33.33 },
      { kind: 'pix', percent: 66.67 },
    ]),
  );
});

test('card limit check is exact to the cent', () => {
  const cards = new Map([
    ['c1', { id: 'c1', name: 'Nubank', limit: '100.00' } as unknown as Card],
  ]);
  const resolved = (amount: number) => [
    { kind: 'card' as const, cardId: 'c1', percent: 100, amount },
  ];
  assert.doesNotThrow(() =>
    assertCardLimits({
      cards,
      resolved: resolved(0.3),
      committedByCard: new Map([['c1', 99.7]]),
    }),
  );
  assert.throws(
    () =>
      assertCardLimits({
        cards,
        resolved: resolved(0.31),
        committedByCard: new Map([['c1', 99.7]]),
      }),
    /Limite insuficiente no cartão Nubank \(disponível R\$ 0,30\)/,
  );
});
