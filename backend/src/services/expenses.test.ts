/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/http/errors';

import {
  parseCreateExpense,
  parsePayExpenseBody,
  parseUpdateExpense,
} from './expense-input';
import { cashAmountOf, existingSplitInputs } from './expenses';

function status(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.status;
    throw error;
  }
  return null;
}

test('cash amount is the PIX share, or everything without splits', () => {
  assert.equal(cashAmountOf([], 120), 120);
  assert.equal(
    cashAmountOf(
      [
        { kind: 'card', amount: 33.33 },
        { kind: 'pix', amount: 66.67 },
      ],
      100,
    ),
    66.67,
  );
  assert.equal(cashAmountOf([{ kind: 'card', amount: 100 }], 100), 0);
});

test('existing split inputs come from rows or from the legacy cardId', () => {
  const rows = existingSplitInputs({
    cardId: null,
    splits: [
      { kind: 'pix', cardId: null, percent: 60 },
      { kind: 'card', cardId: 'c1', percent: 40 },
    ] as never,
  });
  assert.deepEqual(rows, [
    { kind: 'pix', percent: 60 },
    { kind: 'card', cardId: 'c1', percent: 40 },
  ]);
  assert.deepEqual(existingSplitInputs({ cardId: 'c9', splits: [] }), [
    { kind: 'card', cardId: 'c9', percent: 100 },
  ]);
  assert.deepEqual(existingSplitInputs({ cardId: null, splits: [] }), []);
});

test('create input enforces required fields and category rules', () => {
  const base = { name: 'Aluguel', amount: '1500', category: 'outro' };
  const parsed = parseCreateExpense({ ...base, notes: ' obs ' });
  assert.equal(parsed.frequency, 'mensal');
  assert.equal(parsed.notes, 'obs');
  assert.equal(parsed.customTagId, null);

  assert.equal(
    status(() => parseCreateExpense({})),
    400,
  );
  assert.equal(
    status(() => parseCreateExpense({ ...base, amount: '0' })),
    400,
  );
  assert.equal(
    status(() => parseCreateExpense({ ...base, category: 'cofrinho' })),
    400,
  );
  assert.equal(
    status(() => parseCreateExpense({ ...base, frequency: 'diaria' })),
    400,
  );
  assert.equal(
    status(() => parseCreateExpense({ ...base, cardId: 7 })),
    400,
  );
  assert.equal(
    status(() => parseCreateExpense({ ...base, notes: 7 })),
    400,
  );
});

test('update input keeps absent fields undefined', () => {
  const parsed = parseUpdateExpense({ name: 'Novo nome' });
  assert.equal(parsed.name, 'Novo nome');
  assert.equal(parsed.amount, undefined);
  assert.equal(parsed.notes, undefined);
  assert.equal(parsed.cardId, undefined);
  assert.equal(parsed.splits, undefined);
  assert.equal(parseUpdateExpense({ notes: null }).notes, null);
  assert.equal(
    status(() => parseUpdateExpense({ name: '   ' })),
    400,
  );
  assert.equal(
    status(() => parseUpdateExpense({ category: 'x' })),
    400,
  );
});

test('pay body needs a valid month', () => {
  assert.equal(parsePayExpenseBody({ month: '2026-09' }), '2026-09');
  assert.equal(
    status(() => parsePayExpenseBody({ month: '2026-9' })),
    400,
  );
});
