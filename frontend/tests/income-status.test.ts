import assert from 'node:assert/strict';
import test from 'node:test';

import { incomeStatus, salaryWaitLabel } from '@/lib/income-status';
import type { Income } from '@/types/finance';

const now = new Date('2026-10-10T15:00:00.000Z');

function income(overrides: Partial<Income> = {}): Income {
  return {
    id: 'i1',
    name: 'Salário',
    amount: 3000,
    type: 'salario',
    frequency: 'mensal',
    receiveDay: 5,
    startsAt: '2026-01-05',
    ...overrides,
  };
}

test('salary received automatically after its day', () => {
  const status = incomeStatus(income(), now);
  assert.equal(status.kind, 'salary');
  assert.equal(status.salaryAutomatic, true);
  assert.deepEqual(status.note, { tone: 'good', text: 'Recebido automaticamente' });
  assert.equal(status.editable, false);
  assert.equal(salaryWaitLabel(status), 'Ainda não recebi');
});

test('salary waiting for manual confirmation', () => {
  const status = incomeStatus(income({ receiptHoldForMonth: '2026-10' }), now);
  assert.equal(status.salaryWaiting, true);
  assert.deepEqual(status.note, {
    tone: 'warn',
    text: 'Aguardando confirmação manual',
  });
});

test('salary manually confirmed', () => {
  const status = incomeStatus(income({ receivedForMonth: '2026-10' }), now);
  assert.equal(status.salaryManual, true);
  assert.deepEqual(status.note, { tone: 'good', text: 'Recebimento confirmado' });
});

test('salary before its day waits for the date', () => {
  const status = incomeStatus(income({ receiveDay: 20 }), now);
  assert.equal(status.salaryAutomatic, false);
  assert.deepEqual(status.note, { tone: 'muted', text: 'Aguardando dia 20' });
  assert.equal(salaryWaitLabel(status), 'Aguardar confirmação');
});

test('hold and receipts are compared against the São Paulo month', () => {
  // Midnight UTC on Nov 1 is still Oct 31 in São Paulo.
  const lateOctober = new Date('2026-11-01T00:30:00.000Z');
  const status = incomeStatus(income({ receivedForMonth: '2026-10' }), lateOctober);
  assert.equal(status.salaryManual, true);
});

test('one-off income depends on its receipt', () => {
  const pending = incomeStatus(
    income({ type: 'freelance', frequency: 'unica', date: '2026-10-01' }),
    now,
  );
  assert.equal(pending.kind, 'one_off');
  assert.equal(pending.editable, true);
  assert.deepEqual(pending.note, { tone: 'warn', text: 'Aguardando confirmação' });

  const receipt = { month: '2026-10', amount: 3000, receivedAt: '2026-10-02T12:00:00Z' };
  const done = incomeStatus(
    income({
      type: 'freelance',
      frequency: 'unica',
      date: '2026-10-01',
      receipts: [receipt],
    }),
    now,
  );
  assert.deepEqual(done.oneOffReceipt, receipt);
  assert.deepEqual(done.note, { tone: 'good', text: 'Recebimento confirmado' });
});

test('recurring non-salary income shows a note only while waiting', () => {
  const freelance = (receiveDay: number) =>
    incomeStatus(income({ type: 'freelance', receiveDay }), now);
  assert.equal(freelance(5).kind, 'recurring');
  assert.equal(freelance(5).note, null);
  assert.equal(freelance(5).editable, true);
  assert.deepEqual(freelance(20).note, { tone: 'muted', text: 'Aguardando dia 20' });
});

test('other salary cadences are managed in the profile', () => {
  const status = incomeStatus(income({ frequency: 'semanal' }), now);
  assert.equal(status.kind, 'profile');
  assert.equal(status.editable, false);
});
