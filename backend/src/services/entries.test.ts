/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import type { Entry, EntryReceipt } from '@/generated/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import { AppError } from '@/http/errors';

import {
  assertEntryFrequencyTransition,
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

test('entry notes are separate from name and custom income tag', () => {
  const parsed = parseCreateEntry({
    name: 'Presente',
    amount: 20,
    type: 'outro',
    frequency: 'unica',
    customTagId: 'income-tag',
    notes: '  Presente da minha vó  ',
    date: '2026-10-16',
  });
  assert.equal(parsed.name, 'Presente');
  assert.equal(parsed.customTagId, 'income-tag');
  assert.equal(parsed.notes, 'Presente da minha vó');
  assert.equal(parseCreateEntry({
    name: 'Presente', amount: 20, type: 'outro', frequency: 'unica',
  }).notes, null);

  const entry = {
    id: 'entry-notes',
    name: 'Presente',
    notes: 'Presente da minha vó',
    customTagId: 'income-tag',
    amount: new Prisma.Decimal(20),
  } as Entry;
  const serialized = serializeEntry(entry);
  assert.equal(serialized.notes, 'Presente da minha vó');
  assert.equal(serialized.name, 'Presente');
  assert.equal(serialized.customTagId, 'income-tag');
});

test('entry note updates accept null, preserve omitted notes and reject invalid or oversized text', () => {
  assert.equal(parseUpdateEntry({ notes: null }).notes, null);
  assert.equal(parseUpdateEntry({ notes: '  outra descrição  ' }).notes, 'outra descrição');
  assert.equal(parseUpdateEntry({ name: 'Novo' }).notes, undefined);
  const base = { name: 'Presente', amount: 20, type: 'outro', frequency: 'unica' };
  assert.equal(status(() => parseCreateEntry({ ...base, notes: 7 })), 400);
  assert.equal(status(() => parseCreateEntry({ ...base, notes: 'x'.repeat(501) })), 400);
  assert.equal(status(() => parseUpdateEntry({ notes: 'x'.repeat(501) })), 400);
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

test('a received one-off cannot become recurring while its receipt remains immutable', () => {
  for (const recurring of ['mensal', 'semanal'] as const) {
    assert.throws(
      () => assertEntryFrequencyTransition('unica', recurring, true),
      (error: unknown) => error instanceof AppError && error.status === 409 &&
        /recebimento registrado/.test(error.message),
    );
  }

  assert.doesNotThrow(() => assertEntryFrequencyTransition('unica', 'mensal', false));
  assert.doesNotThrow(() => assertEntryFrequencyTransition('unica', 'unica', true));
  assert.doesNotThrow(() => assertEntryFrequencyTransition('mensal', 'semanal', true));
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
