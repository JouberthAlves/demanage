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
      frequency: 'unica',
    }),
  );
  assert.throws(
    () =>
      assertCardLimits({
        cards,
        resolved: resolved(0.31),
        committedByCard: new Map([['c1', 99.7]]),
        frequency: 'unica',
      }),
    /Limite insuficiente no cartão Nubank \(disponível R\$ 0,30\)/,
  );
});

test('card limit reserves a full billing cycle of charges for the frequency', () => {
  const cards = new Map([
    ['c1', { id: 'c1', name: 'Nubank', limit: '100.00' } as unknown as Card],
  ]);
  const check = (amount: number, frequency: string, committed = 0) =>
    assertCardLimits({
      cards,
      resolved: [{ kind: 'card' as const, cardId: 'c1', percent: 100, amount }],
      committedByCard: new Map([['c1', committed]]),
      frequency,
    });

  // weekly R$30 x 5 = R$150 > R$100
  assert.throws(
    () => check(30, 'semanal'),
    /Limite insuficiente no cartão Nubank \(disponível R\$ 100,00\)/,
  );
  // weekly R$20 x 5 = R$100 fits exactly
  assert.doesNotThrow(() => check(20, 'semanal'));
  assert.throws(() => check(20.01, 'semanal'), /Limite insuficiente/);
  // monthly / one-off: a single charge
  assert.doesNotThrow(() => check(100, 'mensal'));
  assert.doesNotThrow(() => check(100, 'unica'));
  assert.throws(() => check(100.01, 'mensal'), /Limite insuficiente/);
  // committed counts against the same budget
  assert.throws(() => check(10, 'semanal', 60), /disponível R\$ 40,00/);
  assert.doesNotThrow(() => check(8, 'semanal', 60));
});

test('editing an expense does not count its own commitment twice', () => {
  const cards = new Map([
    ['c1', { id: 'c1', name: 'Nubank', limit: '100.00' } as unknown as Card],
  ]);
  const resolved = [
    { kind: 'card' as const, cardId: 'c1', percent: 100, amount: 20 },
  ];
  // The service passes committed WITHOUT the edited expense (excludeExpenseId):
  // a weekly R$20 already on the card (committed 100 incl. itself) is fine to
  // re-save once its own 100 is excluded...
  assert.doesNotThrow(() =>
    assertCardLimits({
      cards,
      resolved,
      committedByCard: new Map([['c1', 0]]),
      frequency: 'semanal',
    }),
  );
  // ...but would be rejected if its own commitment were (wrongly) included.
  assert.throws(
    () =>
      assertCardLimits({
        cards,
        resolved,
        committedByCard: new Map([['c1', 100]]),
        frequency: 'semanal',
      }),
    /Limite insuficiente/,
  );
});
