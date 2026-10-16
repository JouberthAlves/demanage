import assert from 'node:assert/strict';
import test from 'node:test';

import { mapEntryToIncome } from '@/lib/entries-api';
import {
  buildIncomePayload,
  emptyIncomeForm,
  formFromIncome,
  validateIncomeForm,
} from '@/lib/income-form';

const now = new Date('2026-10-16T15:00:00.000Z');

test('income notes are mapped and preserved independently from title and custom tag', () => {
  const income = mapEntryToIncome({
    id: 'e1',
    name: 'Presente',
    notes: 'Presente da minha vó',
    amount: 20,
    type: 'outro',
    frequency: 'unica',
    date: '2026-10-16T00:00:00.000Z',
    customTagId: 'income-tag',
    customTag: { id: 'income-tag', name: 'Presente', color: '#34D399' },
  });
  assert.equal(income.notes, 'Presente da minha vó');
  assert.equal(income.name, 'Presente');
  assert.equal(income.customTagId, 'income-tag');

  const form = formFromIncome(income, now);
  assert.equal(form.notes, 'Presente da minha vó');
  const payload = buildIncomePayload(form, { now });
  assert.equal(payload.notes, 'Presente da minha vó');
  assert.equal(payload.name, 'Presente');
  assert.equal(payload.customTagId, 'income-tag');
});

test('income notes are optional, clearable and limited to 500 characters', () => {
  const empty = emptyIncomeForm(now);
  assert.equal(empty.notes, '');
  const form = {
    ...empty,
    name: 'Presente',
    amount: '20,00',
    frequency: 'unica' as const,
    notes: '   ',
  };
  assert.equal(buildIncomePayload(form, { now }).notes, null);
  assert.equal(validateIncomeForm({ ...form, notes: 'x'.repeat(501) }, { now })?.fieldId, 'income-notes');
});
