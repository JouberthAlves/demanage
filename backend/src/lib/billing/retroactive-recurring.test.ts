import assert from 'node:assert/strict';
import test from 'node:test';

import { hasRetroactiveClosedCardCharge } from './retroactive-recurring';

const at = (day: string) => new Date(`${day}T12:00:00.000Z`);
const card = (lastInvoicedOn: string | null) => ({
  createdAt: at('2026-08-01'),
  lastInvoicedOn: lastInvoicedOn ? at(lastInvoicedOn) : null,
});
const recurrence = (frequency: 'mensal' | 'semanal', start: string, day: number) => ({
  amount: '100',
  frequency,
  startsAt: at(start),
  dueDay: day,
  endsAt: null,
});

test('F02 rejects card recurrence whose September charge was already invoiced', () => {
  assert.equal(hasRetroactiveClosedCardCharge(card('2026-09-05'), recurrence('mensal', '2026-09-01', 1)), true);
  assert.equal(hasRetroactiveClosedCardCharge(card('2026-09-05'), recurrence('semanal', '2026-09-01', 1)), true);
});

test('F02 accepts charges starting after last closing, even when start date is in the past', () => {
  assert.equal(hasRetroactiveClosedCardCharge(card('2026-09-05'), recurrence('mensal', '2026-09-07', 10)), false);
  assert.equal(hasRetroactiveClosedCardCharge(card('2026-09-05'), recurrence('mensal', '2026-09-01', 31)), false);
  assert.equal(hasRetroactiveClosedCardCharge(card(null), recurrence('mensal', '2026-09-01', 1)), false);
});

test('F02 ignores empty period and recurrence ended before first eligible date', () => {
  assert.equal(hasRetroactiveClosedCardCharge({createdAt: at('2026-09-10'),lastInvoicedOn: at('2026-09-05')}, recurrence('mensal','2026-09-01',1)), false);
  assert.equal(hasRetroactiveClosedCardCharge(card('2026-09-05'), {...recurrence('mensal','2026-09-01',1), endsAt:at('2026-08-31')}), false);
});
