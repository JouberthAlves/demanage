/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssetTransaction } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import { AppError } from '@/http/errors';

import {
  mergeAssetTransactionPatch,
  parseAssetTransactionPatch,
  parseCreateAssetTransaction,
} from './assets';

const stored = {
  id: 't1',
  userId: 'u1',
  asset: 'BTC',
  type: 'BUY',
  quantity: new Prisma.Decimal('0.5'),
  cashAmountBrl: new Prisma.Decimal('1000'),
  feeAmountBrl: new Prisma.Decimal('10'),
  feePercent: new Prisma.Decimal('1'),
  costBasisKnown: true,
  date: new Date('2026-09-01T12:00:00.000Z'),
  note: 'nota antiga',
  expenseId: null,
  entryId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as AssetTransaction;

function status(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.status;
    throw error;
  }
  return null;
}

test('patch without type is allowed and merges with the stored row', () => {
  const patch = parseAssetTransactionPatch({ note: 'nova' });
  const merged = mergeAssetTransactionPatch(stored, patch);
  assert.equal(merged.type, 'BUY');
  assert.equal(merged.quantity, '0.5');
  assert.equal(merged.cashAmountBrl, '1000');
  assert.equal(merged.feeAmountBrl, '10');
  assert.equal(merged.feePercent, '1');
  assert.equal(merged.date, '2026-09-01T12:00:00.000Z');
  assert.equal(merged.note, 'nova');
});

test('changing cash or percent recalculates the fee from the stored percent', () => {
  const byCash = mergeAssetTransactionPatch(
    stored,
    parseAssetTransactionPatch({ cashAmountBrl: '2000' }),
  );
  assert.equal(byCash.feeAmountBrl, 0);
  assert.equal(byCash.feePercent, '1');

  const explicitFee = mergeAssetTransactionPatch(
    stored,
    parseAssetTransactionPatch({ cashAmountBrl: '2000', feeAmountBrl: '5' }),
  );
  assert.equal(explicitFee.feeAmountBrl, '5');

  const noPercent = mergeAssetTransactionPatch(
    { ...stored, feePercent: null },
    parseAssetTransactionPatch({ cashAmountBrl: '2000' }),
  );
  assert.equal(noPercent.feeAmountBrl, '10');
});

test('note can be cleared and explicit type is validated', () => {
  assert.equal(
    mergeAssetTransactionPatch(
      stored,
      parseAssetTransactionPatch({ note: null }),
    ).note,
    null,
  );
  assert.equal(
    status(() => parseAssetTransactionPatch({ type: 'HODL' })),
    400,
  );
  assert.equal(
    status(() => parseCreateAssetTransaction({})),
    400,
  );
  assert.equal(
    status(() =>
      parseCreateAssetTransaction({ type: 'BUY', costBasisKnown: 'maybe' }),
    ),
    400,
  );
});
