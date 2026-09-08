import assert from 'node:assert/strict';
import test from 'node:test';

import { dateKey } from '@/lib/decimal';
import {
  resolveEntryOccurrenceDate,
  resolveExpenseOccurrenceDate,
} from '@/lib/patrimony';

const scheduled = new Date('2026-09-10T12:00:00.000Z');

test('patrimônio baixa despesa fixa na data do pagamento antecipado', () => {
  const result = resolveExpenseOccurrenceDate(
    {
      frequency: 'mensal',
      paidForMonth: '2026-09',
      paidAt: new Date('2026-09-04T15:00:00.000Z'),
      updatedAt: new Date('2026-09-04T15:00:00.000Z'),
    },
    scheduled,
    '2026-09',
  );

  assert.equal(dateKey(result), '2026-09-04');
});

test('pagamento marcado depois do vencimento mantém a baixa automática no vencimento', () => {
  const result = resolveExpenseOccurrenceDate(
    {
      frequency: 'mensal',
      paidForMonth: '2026-09',
      paidAt: new Date('2026-09-12T15:00:00.000Z'),
      updatedAt: new Date('2026-09-12T15:00:00.000Z'),
    },
    scheduled,
    '2026-09',
  );

  assert.equal(dateKey(result), '2026-09-10');
});

test('registro legado de pagamento usa updatedAt como data de fallback', () => {
  const result = resolveExpenseOccurrenceDate(
    {
      frequency: 'mensal',
      paidForMonth: '2026-09',
      paidAt: null,
      updatedAt: new Date('2026-09-03T15:00:00.000Z'),
    },
    scheduled,
    '2026-09',
  );

  assert.equal(dateKey(result), '2026-09-03');
});

test('salário aguardando confirmação não entra no caixa patrimonial', () => {
  const result = resolveEntryOccurrenceDate(
    {
      type: 'salario',
      frequency: 'mensal',
      receiptHoldForMonth: '2026-09',
      receivedForMonth: null,
      receivedAt: null,
      updatedAt: new Date('2026-09-04T15:00:00.000Z'),
    },
    scheduled,
    '2026-09',
  );

  assert.equal(result, null);
});

test('salário confirmado entra no dia em que foi realmente recebido', () => {
  const result = resolveEntryOccurrenceDate(
    {
      type: 'salario',
      frequency: 'mensal',
      receiptHoldForMonth: null,
      receivedForMonth: '2026-09',
      receivedAt: new Date('2026-09-07T15:00:00.000Z'),
      updatedAt: new Date('2026-09-07T15:00:00.000Z'),
    },
    scheduled,
    '2026-09',
  );

  assert.ok(result);
  assert.equal(dateKey(result), '2026-09-07');
});
