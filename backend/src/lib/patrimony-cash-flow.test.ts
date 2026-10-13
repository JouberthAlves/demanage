import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCashFlows } from '@/lib/patrimony-calc';

const baseDate = new Date('2026-08-31T12:00:00.000Z');
const to = new Date('2026-09-30T12:00:00.000Z');

function expense(overrides: Record<string, unknown> = {}) {
  return {
    id: 'expense-1',
    amount: '999.00',
    isInvoice: false,
    cardId: null,
    frequency: 'mensal',
    occurredAt: null,
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    archivedAt: null,
    systemOrigin: 'manual',
    splits: [],
    payments: [],
    ...overrides,
  } as unknown as Parameters<typeof buildCashFlows>[0]['expenses'][number];
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-1',
    amount: '999.00',
    date: new Date('2026-09-10T12:00:00.000Z'),
    createdAt: new Date('2026-09-01T12:00:00.000Z'),
    archivedAt: null,
    systemOrigin: 'manual',
    receipts: [],
    ...overrides,
  } as unknown as Parameters<typeof buildCashFlows>[0]['entries'][number];
}

function flows(
  expenses: ReturnType<typeof expense>[],
  entries: ReturnType<typeof entry>[] = [],
) {
  return buildCashFlows({
    baseDate,
    to,
    expenses,
    entries,
    internalExpenseIds: new Set(),
    internalEntryIds: new Set(),
  });
}

test('uses a confirmed expense amount and date snapshot after the template changes', () => {
  const result = flows([
    expense({
      archivedAt: new Date('2026-09-20T12:00:00.000Z'),
      payments: [
        {
          amount: '42.35',
          paidAt: new Date('2026-09-04T12:00:00.000Z'),
        },
      ],
    }),
  ]);

  assert.deepEqual(
    result.map((flow) => ({ date: flow.date, amount: flow.amount.toString() })),
    [{ date: '2026-09-04', amount: '-42.35' }],
  );
});

test('does not project an unpaid recurring expense into historical cash flow', () => {
  assert.deepEqual(flows([expense()]), []);
});

test('counts confirmed income by its receipt snapshot instead of the scheduled date or current amount', () => {
  const result = flows([], [
    entry({
      amount: '7500.00',
      date: new Date('2026-09-10T12:00:00.000Z'),
      receipts: [
        {
          amount: '5100.00',
          receivedAt: new Date('2026-09-12T12:00:00.000Z'),
        },
      ],
    }),
  ]);

  assert.deepEqual(
    result.map((flow) => ({ date: flow.date, amount: flow.amount.toString() })),
    [{ date: '2026-09-12', amount: '5100' }],
  );
});

test('does not count a one-off income scheduled in the past without a receipt', () => {
  assert.deepEqual(flows([], [entry()]), []);
});

test('card invoice affects cash flow only after a payment snapshot exists', () => {
  const pendingInvoice = expense({
    isInvoice: true,
    amount: '125.00',
    occurredAt: new Date('2026-09-15T12:00:00.000Z'),
    createdAt: new Date('2026-09-15T12:00:00.000Z'),
  });
  assert.deepEqual(flows([pendingInvoice]), []);

  const paidInvoice = expense({
    ...pendingInvoice,
    payments: [
      {
        amount: '125.00',
        paidAt: new Date('2026-09-20T12:00:00.000Z'),
      },
    ],
  });
  assert.deepEqual(
    flows([paidInvoice]).map((flow) => ({
      date: flow.date,
      amount: flow.amount.toString(),
    })),
    [{ date: '2026-09-20', amount: '-125' }],
  );
});

test('keeps system generated piggy or asset ledger flows internal', () => {
  const result = flows([
    expense({
      amount: '25.00',
      occurredAt: new Date('2026-09-05T12:00:00.000Z'),
      systemOrigin: 'asset',
    }),
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].amount.toString(), '-25');
  assert.equal(result[0].external, false);
});
