import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOneOffReceiptConfirmation,
  buildOneOffReceiptUndo,
} from '@/lib/income-receipt-confirmation';
import type { Income } from '@/types/finance';

const now = new Date('2026-10-24T12:00:00.000Z');
const income: Income = {
  id: 'legacy-700',
  name: 'Entrada antiga',
  amount: 700,
  type: 'outro',
  frequency: 'unica',
  date: '2026-10-09',
  updatedAt: '2026-10-08T10:00:00.000Z',
};

test('user-confirmed historical receipt sends the actual cash date and optimistic version', () => {
  assert.deepEqual(buildOneOffReceiptConfirmation(income, '2026-10-09', now), {
    id: 'legacy-700',
    month: '2026-10',
    state: 'received',
    receivedOn: '2026-10-09',
    expectedUpdatedAt: '2026-10-08T10:00:00.000Z',
  });
  assert.throws(() =>
    buildOneOffReceiptConfirmation(income, '2026-02-30', now),
  );
  assert.throws(() =>
    buildOneOffReceiptConfirmation(income, '2026-10-25', now),
  );
  assert.throws(() =>
    buildOneOffReceiptConfirmation(
      { ...income, updatedAt: undefined },
      '2026-10-09',
      now,
    ),
  );
  assert.throws(() =>
    buildOneOffReceiptConfirmation(
      {
        ...income,
        receipts: [
          {
            id: 'paid',
            month: '2026-10',
            amount: 700,
            receivedAt: '2026-10-09T12:00:00.000Z',
          },
        ],
      },
      '2026-10-09',
      now,
    ),
  );
});

test('undo is tied to the current receipt month and row version', () => {
  const confirmed = {
    ...income,
    updatedAt: '2026-10-24T12:00:00.000Z',
    receipts: [
      {
        id: 'receipt-700',
        month: '2026-10',
        amount: 700,
        receivedAt: '2026-10-09T12:00:00.000Z',
      },
    ],
  };
  assert.deepEqual(buildOneOffReceiptUndo(confirmed), {
    id: 'legacy-700',
    month: '2026-10',
    state: 'waiting',
    expectedUpdatedAt: '2026-10-24T12:00:00.000Z',
  });
  assert.throws(() => buildOneOffReceiptUndo(income));
});
