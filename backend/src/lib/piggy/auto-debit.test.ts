import assert from 'node:assert/strict';
import test from 'node:test';

import { todayInSaoPaulo } from '@/lib/civil-date';
import {
  currentAutoDebitCycle,
  hasAutoDebitInCycle,
  listDueAutoDebitCycles,
} from '@/lib/piggy/auto-debit';
import { balanceFromTransactions } from '@/lib/piggy/ledger';
import {
  computeMonthlyGoal,
  parseOptionalTargetDate,
  serializePiggyTransaction,
} from '@/lib/piggy/model';

test('target date accepts today and rejects a past date in São Paulo time', () => {
  const today = todayInSaoPaulo();
  const todayKey = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  assert.equal(parseOptionalTargetDate(todayKey)?.toISOString().slice(0, 10), todayKey);
  assert.throws(
    () => parseOptionalTargetDate(yesterday.toISOString().slice(0, 10)),
    /PAST_TARGET_DATE/,
  );
  assert.throws(() => parseOptionalTargetDate('2026-02-30'), /INVALID_TARGET_DATE/);
});

test('monthly goal is rounded half-up to cents (R$0.29 / 2 = 0.15)', () => {
  const target = new Date('2026-11-30T12:00:00.000Z');
  const from = new Date('2026-09-30T15:00:00.000Z');
  assert.equal(computeMonthlyGoal(0.29, target, from), 0.15);
  assert.equal(computeMonthlyGoal(1000, target, from), 500);
  assert.equal(computeMonthlyGoal(100, new Date('2026-12-31T12:00:00.000Z'), from), 33.33);
  assert.equal(computeMonthlyGoal(null, target, from), 0);
});

test('auto-debit catches up an overdue day once and records the due date', () => {
  const now = new Date('2026-09-30T16:00:00.000Z');
  const cycle = currentAutoDebitCycle(now, new Date('2026-09-01T12:00:00.000Z'), 5);

  assert.equal(cycle?.dueOn.toISOString(), '2026-09-05T12:00:00.000Z');
  assert.equal(
    currentAutoDebitCycle(
      new Date('2026-09-04T16:00:00.000Z'),
      new Date('2026-09-01T12:00:00.000Z'),
      5,
    ),
    null,
  );
  assert.equal(
    currentAutoDebitCycle(now, new Date('2026-09-05T12:00:00.000Z'), 5),
    null,
  );
});

test('auto-debit idempotency uses the São Paulo calendar month', () => {
  const cycle = currentAutoDebitCycle(
    new Date('2026-09-30T16:00:00.000Z'),
    new Date('2026-09-01T12:00:00.000Z'),
    5,
  );
  assert.equal(
    hasAutoDebitInCycle(
      [
        {
          type: 'deposit',
          source: 'auto_debit',
          date: new Date('2026-10-01T02:30:00.000Z'),
        },
      ],
      cycle,
    ),
    true,
  );
});

test('missed auto-debit months are listed oldest first, not just the current one', () => {
  const cycles = listDueAutoDebitCycles(
    new Date('2026-11-20T16:00:00.000Z'),
    new Date('2026-08-20T12:00:00.000Z'),
    10,
  );
  assert.deepEqual(
    cycles.map((cycle) => cycle.dueOn.toISOString().slice(0, 10)),
    ['2026-09-10', '2026-10-10', '2026-11-10'],
  );
  // Created after this month's due day -> no cycle for that month.
  assert.deepEqual(
    listDueAutoDebitCycles(
      new Date('2026-11-20T16:00:00.000Z'),
      new Date('2026-11-12T12:00:00.000Z'),
      10,
    ),
    [],
  );
  // Day 31 clamps to the month end.
  assert.deepEqual(
    listDueAutoDebitCycles(
      new Date('2026-03-01T16:00:00.000Z'),
      new Date('2026-01-01T12:00:00.000Z'),
      31,
    ).map((cycle) => cycle.dueOn.toISOString().slice(0, 10)),
    ['2026-01-31', '2026-02-28'],
  );
});

test('a cycle already carrying an auto-debit is skipped, an empty one is not', () => {
  const [sept, oct] = listDueAutoDebitCycles(
    new Date('2026-10-20T16:00:00.000Z'),
    new Date('2026-08-20T12:00:00.000Z'),
    10,
  );
  const ledger = [
    {
      type: 'deposit' as const,
      source: 'auto_debit' as const,
      date: new Date('2026-09-10T12:00:00.000Z'),
    },
  ];
  assert.equal(hasAutoDebitInCycle(ledger, sept), true);
  assert.equal(hasAutoDebitInCycle(ledger, oct), false);
});

test('the single balance function adds deposits and interest, subtracts withdrawals', () => {
  assert.equal(
    balanceFromTransactions([
      { type: 'deposit', amount: '100.10' },
      { type: 'interest', amount: '0.20' },
      { type: 'withdraw', amount: '50.05' },
    ]),
    50.25,
  );
});

test('serialization exposes cents even though interest rows store 8 decimals', () => {
  const serialized = serializePiggyTransaction({
    id: 'tx',
    piggyBankId: 'bank',
    userId: 'user',
    type: 'interest',
    source: 'yield',
    amount: '0.01',
    date: new Date('2026-09-08T12:00:00.000Z'),
    expenseId: null,
    entryId: null,
    note: null,
    cdiRate: '0.055131',
    cdiPercent: '100',
    baseBalance: '10.00345678',
    resultingBalance: '10.00901234',
    interestKey: 'k',
    createdAt: new Date('2026-09-09T12:00:00.000Z'),
  } as unknown as Parameters<typeof serializePiggyTransaction>[0]);
  assert.equal(serialized.baseBalance, 10);
  assert.equal(serialized.resultingBalance, 10.01);
  assert.equal(serialized.date, '2026-09-08');
});

test('auto-debit enabled in October never back-fills the months since creation', () => {
  const due = (cycles: ReturnType<typeof listDueAutoDebitCycles>) =>
    cycles.map((cycle) => cycle.dueOn.toISOString().slice(0, 10));
  const now = new Date('2026-12-20T16:00:00.000Z');
  const created = new Date('2026-01-05T12:00:00.000Z');

  // Control: without the enabled date the old back-fill behaviour is unchanged.
  assert.equal(listDueAutoDebitCycles(now, created, 10).length, 12);
  // Enabled on 2026-10-02: October, November and December only.
  assert.deepEqual(
    due(
      listDueAutoDebitCycles(now, created, 10, new Date('2026-10-02T15:00:00.000Z')),
    ),
    ['2026-10-10', '2026-11-10', '2026-12-10'],
  );
});

test('auto-debit enabled after this month\'s due day starts next month', () => {
  const created = new Date('2026-01-05T12:00:00.000Z');
  const enabledAt = new Date('2026-10-20T15:00:00.000Z'); // after day 10
  // Still October: the 10th already passed before enabling -> nothing due.
  assert.deepEqual(
    listDueAutoDebitCycles(new Date('2026-10-25T16:00:00.000Z'), created, 10, enabledAt),
    [],
  );
  assert.equal(
    currentAutoDebitCycle(new Date('2026-10-25T16:00:00.000Z'), created, 10, enabledAt),
    null,
  );
  // November: due on the 10th.
  assert.deepEqual(
    listDueAutoDebitCycles(
      new Date('2026-11-12T16:00:00.000Z'),
      created,
      10,
      enabledAt,
    ).map((cycle) => cycle.dueOn.toISOString().slice(0, 10)),
    ['2026-11-10'],
  );
});

test('auto-debit enabled on or before the due day debits that month', () => {
  const created = new Date('2026-01-05T12:00:00.000Z');
  const now = new Date('2026-10-25T16:00:00.000Z');
  for (const enabledAt of ['2026-10-10T15:00:00.000Z', '2026-10-01T03:00:00.000Z']) {
    assert.deepEqual(
      listDueAutoDebitCycles(now, created, 10, new Date(enabledAt)).map((cycle) =>
        cycle.dueOn.toISOString().slice(0, 10),
      ),
      ['2026-10-10'],
    );
  }
});

test('catch-up cap still applies when enabled long ago', () => {
  const cycles = listDueAutoDebitCycles(
    new Date('2036-12-20T16:00:00.000Z'),
    new Date('2020-01-01T12:00:00.000Z'),
    10,
    new Date('2020-01-01T12:00:00.000Z'),
  );
  assert.equal(cycles.length, 60);
});
