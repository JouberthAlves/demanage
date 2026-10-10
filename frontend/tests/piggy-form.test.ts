import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPiggyPayload,
  EMPTY_PIGGY_FORM,
  formFromBank,
  type PiggyFormState,
} from '@/lib/piggy-form';
import type { PiggyBank } from '@/types/finance';

function form(changes: Partial<PiggyFormState> = {}): PiggyFormState {
  return { ...EMPTY_PIGGY_FORM, name: 'Reserva', ...changes };
}

function expectOk(result: ReturnType<typeof buildPiggyPayload>) {
  if (!result.ok) throw new Error(result.error);
  return result.payload;
}

test('plain piggy bank without goal, yield or auto debit', () => {
  const payload = expectOk(buildPiggyPayload(form(), 0));
  assert.deepEqual(payload, {
    name: 'Reserva',
    goalAmount: null,
    targetDate: null,
    monthlyGoal: 0,
    autoDebit: false,
    autoDebitDay: 1,
    isEmergency: false,
    yieldEnabled: false,
    cdiPercent: 0,
  });
});

test('requires a name', () => {
  const result = buildPiggyPayload(form({ name: '   ' }), 0);
  assert.equal(result.ok, false);
});

test('yield with empty CDI percent is rejected instead of saving 0%', () => {
  const result = buildPiggyPayload(
    form({ yieldEnabled: true, cdiPercent: '' }),
    0,
  );
  assert.equal(result.ok, false);
});

test('yield requires a CDI percent above zero and up to 1000', () => {
  for (const cdiPercent of ['0', '0,00', '-5', '1001', 'abc']) {
    const result = buildPiggyPayload(form({ yieldEnabled: true, cdiPercent }), 0);
    assert.equal(result.ok, false, cdiPercent);
  }
});

test('yield accepts pt-BR percent', () => {
  const payload = expectOk(
    buildPiggyPayload(form({ yieldEnabled: true, cdiPercent: '112,5' }), 0),
  );
  assert.equal(payload.yieldEnabled, true);
  assert.equal(payload.cdiPercent, 112.5);
});

test('cdi percent is ignored when yield is off', () => {
  const payload = expectOk(
    buildPiggyPayload(form({ yieldEnabled: false, cdiPercent: '' }), 0),
  );
  assert.equal(payload.cdiPercent, 0);
});

test('goal amount is parsed from the BRL mask', () => {
  const payload = expectOk(
    buildPiggyPayload(form({ goalAmount: '1.500,50' }), 0),
  );
  assert.equal(payload.goalAmount, 1500.5);
});

test('auto debit uses the suggested monthly goal, else the typed amount', () => {
  const suggested = expectOk(
    buildPiggyPayload(form({ autoDebit: true, autoDebitDay: '15' }), 250),
  );
  assert.equal(suggested.monthlyGoal, 250);
  assert.equal(suggested.autoDebitDay, 15);

  const typed = expectOk(
    buildPiggyPayload(
      form({ autoDebit: true, monthlyDebitAmount: '100,00' }),
      0,
    ),
  );
  assert.equal(typed.monthlyGoal, 100);

  const missing = buildPiggyPayload(form({ autoDebit: true }), 0);
  assert.equal(missing.ok, false);
});

test('formFromBank seeds comma decimals and empties for missing goal', () => {
  const bank = {
    id: 'b1',
    name: 'Viagem',
    goalAmount: null,
    targetDate: null,
    monthlyGoal: 0,
    autoDebit: false,
    autoDebitDay: 0,
    isEmergency: true,
    yieldEnabled: true,
    cdiPercent: 112.5,
  } as PiggyBank;
  const seeded = formFromBank(bank);
  assert.equal(seeded.goalAmount, '');
  assert.equal(seeded.cdiPercent, '112,5');
  assert.equal(seeded.autoDebitDay, '1');
  assert.equal(formFromBank(null), EMPTY_PIGGY_FORM);
});
