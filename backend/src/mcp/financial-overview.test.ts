import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateMonthlyCash } from './financial-overview';

test('dashboard balance includes scheduled income, cash expense and linked piggy transfers', () => {
  const result = calculateMonthlyCash({
    today: '2026-10-18',
    entries: [
      { amount: 300, frequency: 'mensal', type: 'salario', receiveDay: 10 },
      { amount: 30, frequency: 'unica', type: 'outro', date: '2026-10-17' },
    ],
    expenses: [
      { amount: 100, frequency: 'mensal', dueDay: 12, splits: [] },
      { amount: 80, frequency: 'unica', occurredAt: '2026-10-16', splits: [{ kind: 'card', amount: 60 }, { kind: 'pix', amount: 20 }] },
    ],
    movements: [{ type: 'deposit', amount: 25, date: '2026-10-17' }, { type: 'withdraw', amount: 5, date: '2026-10-17' }],
  });
  assert.deepEqual(result, { month: '2026-10', incomeBrl: '335.00', expensesBrl: '145.00', balanceBrl: '190.00' });
});

test('dashboard balance excludes future/held salaries, card-only payments and out-of-month events', () => {
  const result = calculateMonthlyCash({
    today: '2026-10-18',
    entries: [
      { amount: 200, frequency: 'mensal', type: 'salario', receiveDay: 10, receiptHoldForMonth: '2026-10' },
      { amount: 70, frequency: 'mensal', type: 'salario', receiveDay: 28 },
      { amount: 50, frequency: 'unica', type: 'outro', date: '2026-11-01' },
    ],
    expenses: [
      { amount: 70, frequency: 'mensal', dueDay: 22, splits: [] },
      { amount: 90, frequency: 'unica', occurredAt: '2026-10-11', cardId: 'card', splits: [] },
    ],
    movements: [{ type: 'deposit', amount: 10, date: '2026-09-30' }],
  });
  assert.equal(result.balanceBrl, '0.00');
});

test('dashboard counts salary already confirmed and invoice payments by São Paulo local date', () => {
  const result = calculateMonthlyCash({
    today: '2026-10-31',
    entries: [{
      amount: 100,
      frequency: 'mensal',
      type: 'salario',
      receiveDay: 25,
      startsAt: '2026-10-26',
      receivedForMonth: '2026-10',
    }],
    expenses: [{
      amount: 999,
      isInvoice: true,
      frequency: 'unica',
      payments: [{ amount: 40, paidAt: new Date('2026-11-01T01:00:00.000Z') }],
    }],
    movements: [],
  });
  assert.equal(result.balanceBrl, '60.00');
});
