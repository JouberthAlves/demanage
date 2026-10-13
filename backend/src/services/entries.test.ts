/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Entry, EntryReceipt } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import { AppError } from '@/http/errors';

import {
  parseCreateEntry,
  parseReceiptStateBody,
  parseUpdateEntry,
  salaryReceiptFields,
  serializeEntry,
} from './entries';

function status(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.status;
    throw error;
  }
  return null;
}

test('serializeEntry returns numbers for the entry and its receipts', () => {
  const entry = {
    id: 'e1',
    amount: new Prisma.Decimal('120.50'),
    receipts: [
      { id: 'r1', month: '2026-09', amount: new Prisma.Decimal('100') },
    ] as unknown as EntryReceipt[],
  } as unknown as Entry & { receipts: EntryReceipt[] };

  const serialized = serializeEntry(entry);
  assert.equal(serialized.amount, 120.5);
  assert.equal(serialized.receipts?.[0].amount, 100);
  assert.equal(
    serializeEntry({ ...entry, receipts: undefined }).receipts,
    undefined,
  );
});

test('create input validates required fields, salary and tag type', () => {
  const parsed = parseCreateEntry({
    name: ' Freela ',
    amount: 10,
    type: 'freelance',
    frequency: 'unica',
    date: '2026-09-01',
  });
  assert.equal(parsed.name, 'Freela');
  assert.equal(parsed.customTagId, null);
  assert.equal(parsed.schedule.date, '2026-09-01');

  assert.equal(
    status(() => parseCreateEntry({})),
    400,
  );
  assert.equal(
    status(() =>
      parseCreateEntry({
        name: 'x',
        amount: 1,
        type: 'salario',
        frequency: 'mensal',
      }),
    ),
    400,
  );
  assert.equal(
    status(() =>
      parseCreateEntry({ name: 'x', amount: 1, type: 'outro', frequency: 'x' }),
    ),
    400,
  );
  assert.equal(
    status(() =>
      parseCreateEntry({
        name: 'x',
        amount: 1,
        type: 'outro',
        frequency: 'mensal',
        customTagId: 5,
      }),
    ),
    400,
  );
});

test('update input is partial and refuses the salary type', () => {
  const parsed = parseUpdateEntry({ amount: '15.5' });
  assert.equal(parsed.amount, 15.5);
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.customTagId, undefined);
  assert.equal(parseUpdateEntry({ customTagId: null }).customTagId, null);
  assert.equal(
    status(() => parseUpdateEntry({ type: 'salario' })),
    400,
  );
  assert.equal(
    status(() => parseUpdateEntry({ amount: '-1' })),
    400,
  );
});

test('receipt state body and salary fields', () => {
  assert.deepEqual(
    parseReceiptStateBody({ month: '2026-09', state: 'received' }),
    {
      month: '2026-09',
      state: 'received',
    },
  );
  assert.equal(
    status(() => parseReceiptStateBody({ month: '2026-09' })),
    400,
  );
  assert.equal(
    status(() => parseReceiptStateBody({ month: '09', state: 'received' })),
    400,
  );

  const at = new Date();
  assert.deepEqual(salaryReceiptFields('received', '2026-09', at), {
    receivedForMonth: '2026-09',
    receiptHoldForMonth: null,
    receivedAt: at,
  });
  assert.deepEqual(salaryReceiptFields('waiting', '2026-09', null), {
    receivedForMonth: null,
    receiptHoldForMonth: '2026-09',
    receivedAt: null,
  });
  assert.deepEqual(salaryReceiptFields('automatic', '2026-09', null), {
    receivedForMonth: null,
    receiptHoldForMonth: null,
    receivedAt: null,
  });
});
