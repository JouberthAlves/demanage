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
  assert.deepEqual(result, { month: '2026-10', incomeBrl: '305.00', expensesBrl: '145.00', balanceBrl: '160.00' });
});

test('F09: MCP cash realized excludes unreceived one-off income regardless of due date', () => {
  const result = calculateMonthlyCash({
    today: '2026-10-18',
    entries: [
      { amount: 700, frequency: 'unica', type: 'outro', date: '2026-10-02', receipts: [] },
      { amount: 900, frequency: 'unica', type: 'outro', date: '2026-10-03', receipts: [{ month: '2026-10', amount: 250, receivedAt: new Date('2026-10-07T17:00:00.000Z') }] },
    ],
    expenses: [],
    movements: [],
  });
  assert.equal(result.incomeBrl, '250.00');
  assert.equal(result.balanceBrl, '250.00');
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

test('archiving preserves immutable paid and received cash movements, not old schedules', () => {
  const archived = calculateMonthlyCash({
    today: '2026-10-18',
    entries: [{
      amount: 999,
      frequency: 'unica',
      type: 'outro',
      date: '2026-10-02',
      archivedAt: new Date('2026-10-16T12:00:00.000Z'),
      receipts: [{ month: '2026-10', amount: 45, receivedAt: new Date('2026-10-10T14:00:00.000Z') }],
    }],
    expenses: [{
      amount: 999,
      frequency: 'unica',
      occurredAt: '2026-10-02',
      archivedAt: new Date('2026-10-16T12:00:00.000Z'),
      payments: [{ month: '2026-10', amount: 35, paidAt: new Date('2026-10-11T14:00:00.000Z') }],
    }],
    movements: [],
  });
  assert.equal(archived.incomeBrl, '45.00');
  assert.equal(archived.expensesBrl, '35.00');
  assert.equal(archived.balanceBrl, '10.00');
});

test('archived recurring obligations without recorded cash do not create phantom movements', () => {
  const result = calculateMonthlyCash({
    today: '2026-10-18',
    entries: [{ amount: 300, frequency: 'mensal', type: 'outro', receiveDay: 10, archivedAt: '2026-10-17' }],
    expenses: [{ amount: 100, frequency: 'mensal', dueDay: 10, archivedAt: '2026-10-17' }],
    movements: [],
  });
  assert.equal(result.incomeBrl, '0.00');
  assert.equal(result.expensesBrl, '0.00');
});

test('prepaying multiple recurring cycles counts real payments only in their payment month', () => {
  const expense = {
    amount: 100,
    frequency: 'mensal',
    dueDay: 10,
    paidForMonth: '2026-12',
    payments: [
      { month: '2026-10', amount: 80, paidAt: new Date('2026-10-02T13:00:00.000Z') },
      { month: '2026-11', amount: 90, paidAt: new Date('2026-10-03T13:00:00.000Z') },
      { month: '2026-12', amount: 70, paidAt: new Date('2026-10-04T13:00:00.000Z') },
    ],
  };
  const october = calculateMonthlyCash({
    today: '2026-10-18', entries: [], expenses: [expense], movements: [],
  });
  const november = calculateMonthlyCash({
    today: '2026-11-18', entries: [], expenses: [expense], movements: [],
  });
  assert.equal(october.expensesBrl, '240.00');
  assert.equal(november.expensesBrl, '0.00');
});

test('early received salary uses the receipt date and never adds its schedule twice', () => {
  const entry = {
    amount: 100,
    frequency: 'mensal',
    type: 'salario',
    receiveDay: 15,
    receivedForMonth: '2026-11',
    receipts: [
      { month: '2026-10', amount: 95, receivedAt: new Date('2026-09-30T14:00:00.000Z') },
      { month: '2026-11', amount: 75, receivedAt: new Date('2026-10-10T14:00:00.000Z') },
    ],
  };
  const october = calculateMonthlyCash({ today: '2026-10-18', entries: [entry], expenses: [], movements: [] });
  const november = calculateMonthlyCash({ today: '2026-11-18', entries: [entry], expenses: [], movements: [] });
  assert.equal(october.incomeBrl, '75.00');
  assert.equal(november.incomeBrl, '0.00');
});

test('a next-month recurring cycle paid at the São Paulo month boundary stays in the payment month', () => {
  const expense = {
    amount: 100,
    frequency: 'mensal',
    dueDay: 10,
    startsAt: '2026-11-01',
    payments: [{
      month: '2026-11', amount: 60,
      paidAt: new Date('2026-11-01T01:30:00.000Z'), // 2026-10-31 in São Paulo
    }],
  };
  const october = calculateMonthlyCash({ today: '2026-10-31', entries: [], expenses: [expense], movements: [] });
  const november = calculateMonthlyCash({ today: '2026-11-20', entries: [], expenses: [expense], movements: [] });
  assert.equal(october.expensesBrl, '60.00');
  assert.equal(november.expensesBrl, '0.00');
});
