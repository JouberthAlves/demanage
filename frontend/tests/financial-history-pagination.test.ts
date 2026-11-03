import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectFinancialHistoryPages,
  type FinancialHistoryPage,
} from '@/lib/financial-history-api';

test('B13 collects separate historical ledgers across pages without losing archived cash', async () => {
  const calls: URLSearchParams[] = [];
  const snapshot = '2026-11-02T20:00:00.000Z';
  const rows = [
    {
      snapshot, expenses: [{ id: 'e-3' }, { id: 'e-2' }], incomes: [{ id: 'i-3' }],
      nextExpenseCursor: 'E2', nextIncomeCursor: null,
    },
    {
      snapshot, expenses: [{ id: 'e-1' }], incomes: [],
      nextExpenseCursor: null, nextIncomeCursor: null,
    },
  ] as unknown as FinancialHistoryPage[];
  const result = await collectFinancialHistoryPages(async (params) => {
    calls.push(params);
    return rows[calls.length - 1]!;
  });
  assert.deepEqual(result.expenses.map((x) => x.id), ['e-3', 'e-2', 'e-1']);
  assert.deepEqual(result.incomes.map((x) => x.id), ['i-3']);
  assert.equal(calls[0]?.has('snapshot'), false);
  assert.equal(calls[1]?.get('snapshot'), snapshot);
  assert.equal(calls[1]?.get('expenseCursor'), 'E2');
  assert.equal(calls[1]?.get('incomeCursor'), 'end');
  assert.equal(calls[1]?.get('limit'), '200');
});

test('B13 rejects a repeating next cursor instead of infinite queries or silently wrong financial totals', async () => {
  let calls = 0;
  await assert.rejects(
    collectFinancialHistoryPages(async () => {
      calls++;
      return {
        snapshot: '2026-11-02T20:00:00.000Z',
        expenses: [{ id: 'e' }] as FinancialHistoryPage['expenses'],
        incomes: [],
        nextExpenseCursor: 'same-cursor',
        nextIncomeCursor: null,
      };
    }),
    /cursor repeated/,
  );
  assert.equal(calls, 2);
});

test('B13 does not display incomplete balance from a malformed page', async () => {
  await assert.rejects(
    collectFinancialHistoryPages(async () => ({
      snapshot: '2026-11-02T20:00:00.000Z',
      expenses: [],
      incomes: [],
      nextExpenseCursor: undefined,
      nextIncomeCursor: null,
    }) as unknown as FinancialHistoryPage),
    /Invalid financial history page/,
  );
});

test('B13 cancels pagination on account session change instead of mixing old and new ledgers', async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(
    collectFinancialHistoryPages(async () => {
      requests++;
      controller.abort();
      return {
        snapshot: '2026-11-02T20:00:00.000Z',
        expenses: [{ id: 'old-account' }] as FinancialHistoryPage['expenses'],
        incomes: [], nextExpenseCursor: 'next-page', nextIncomeCursor: null,
      };
    }, controller.signal),
    /abort/i,
  );
  assert.equal(requests, 1);
});
