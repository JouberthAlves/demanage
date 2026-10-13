import assert from 'node:assert/strict';
import test from 'node:test';

import { expensePayState, expenseStatusNote } from '@/lib/expense-pay-state';
import type { RecurringExpense } from '@/types/finance';

const now = new Date('2026-10-10T15:00:00.000Z');

function expense(overrides: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: 'e1',
    name: 'Internet',
    amount: 100,
    category: 'assinatura',
    frequency: 'mensal',
    dueDay: 5,
    startsAt: '2026-01-05',
    ...overrides,
  };
}

test('already debited cash expense can be confirmed', () => {
  assert.deepEqual(expensePayState(expense(), now, false), {
    label: 'Confirmar pagamento',
    disabled: false,
  });
  assert.equal(expensePayState(expense(), now, true).disabled, true);
});

test('upcoming cash expense can be paid early', () => {
  const upcoming = expense({ dueDay: 20 });
  assert.deepEqual(expensePayState(upcoming, now, false), {
    label: 'Pagar agora',
    disabled: false,
  });
  assert.equal(expensePayState(upcoming, now, true).disabled, true);
});

test('paid, card-only, one-off and not-yet-started states are disabled', () => {
  assert.deepEqual(
    expensePayState(expense({ paidForMonth: '2026-10' }), now, false),
    { label: 'Pago', disabled: true },
  );
  assert.deepEqual(
    expensePayState(expense({ cardId: 'c1' }), now, false),
    { label: 'Via fatura', disabled: true },
  );
  assert.deepEqual(
    expensePayState(expense({ frequency: 'unica', dueDay: undefined }), now, false),
    { label: 'Pago', disabled: true },
  );
  assert.deepEqual(
    expensePayState(expense({ startsAt: '2027-01-05' }), now, false),
    { label: 'Aguardando', disabled: true },
  );
});

test('invoices are confirmed once per month', () => {
  const invoice = expense({ isInvoice: true, frequency: 'unica', dueDay: undefined });
  assert.deepEqual(expensePayState(invoice, now, false), {
    label: 'Confirmar pagamento',
    disabled: false,
  });
  const paid = {
    ...invoice,
    payments: [{ month: '2026-10', amount: 100, paidAt: '2026-10-08T15:00:00.000Z' }],
  };
  assert.deepEqual(expensePayState(paid, now, false), {
    label: 'Pago',
    disabled: true,
  });
});

test('status note follows the same states', () => {
  assert.deepEqual(expenseStatusNote(expense({ paidForMonth: '2026-10' }), now), {
    tone: 'good',
    text: 'Pagamento confirmado',
  });
  assert.deepEqual(expenseStatusNote(expense(), now), {
    tone: 'warn',
    text: 'Já no saldo; confirme quando pagar',
  });
  assert.deepEqual(expenseStatusNote(expense({ dueDay: 20 }), now), {
    tone: 'muted',
    text: 'Aguardando dia 20',
  });
  assert.equal(expenseStatusNote(expense({ cardId: 'c1' }), now), null);
  assert.equal(expenseStatusNote(expense({ frequency: 'unica' }), now), null);
});

test('the São Paulo day decides whether the debit day was reached', () => {
  // 02:00 UTC on Oct 5 is still Oct 4 in São Paulo.
  const beforeDebit = new Date('2026-10-05T02:00:00.000Z');
  assert.equal(expensePayState(expense(), beforeDebit, false).label, 'Pagar agora');
  const afterDebit = new Date('2026-10-05T12:00:00.000Z');
  assert.equal(
    expensePayState(expense(), afterDebit, false).label,
    'Confirmar pagamento',
  );
});
