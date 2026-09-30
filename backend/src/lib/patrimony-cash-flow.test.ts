import assert from 'node:assert/strict';
import test from 'node:test';

import { dateKey } from '@/lib/decimal';
import { validateHistoryRange } from '@/lib/market-data';
import {
  calculationStart,
  resolveEntryOccurrenceDate,
  resolveExpenseOccurrenceDate,
} from '@/lib/patrimony';

const scheduled = new Date('2026-09-10T12:00:00.000Z');

test('baseline patrimonial antiga preserva o início da janela de dez anos', () => {
  const start = calculationStart(
    new Date('2010-01-01T12:00:00.000Z'),
    new Date('2026-09-29T12:00:00.000Z'),
  );

  assert.equal(dateKey(start), '2016-09-29');
});

test('lookup de preço limita o lookback sem exceder o intervalo máximo', () => {
  const today = new Date('2030-01-01T12:00:00.000Z');
  const start = calculationStart(new Date('2010-01-01T12:00:00.000Z'), today);
  const marketFrom = new Date(start);
  marketFrom.setUTCDate(marketFrom.getUTCDate() - 10);

  assert.equal(dateKey(start), '2020-01-02');
  assert.equal(dateKey(marketFrom), '2019-12-23');
  assert.ok(marketFrom < start);
  assert.doesNotThrow(() =>
    validateHistoryRange(dateKey(marketFrom), dateKey(today), today),
  );
});

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
