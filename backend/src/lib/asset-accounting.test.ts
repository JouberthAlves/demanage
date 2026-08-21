import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAssetAccounting,
  enrichAccountingWithQuote,
} from '@/lib/asset-accounting';
import { decimal } from '@/lib/decimal';

test('BTC: preço médio ponderado, venda parcial e resultado realizado', () => {
  const accounting = calculateAssetAccounting('BTC', [
    {
      asset: 'BTC',
      type: 'BUY',
      quantity: '0.001',
      cashAmountBrl: '300',
      feeAmountBrl: '1',
      costBasisKnown: true,
      date: new Date('2026-01-01'),
    },
    {
      asset: 'BTC',
      type: 'BUY',
      quantity: '0.001',
      cashAmountBrl: '500',
      feeAmountBrl: '2',
      costBasisKnown: true,
      date: new Date('2026-01-02'),
    },
    {
      asset: 'BTC',
      type: 'SELL',
      quantity: '0.0005',
      cashAmountBrl: '250',
      feeAmountBrl: '1',
      costBasisKnown: true,
      date: new Date('2026-01-03'),
    },
  ]);
  assert.equal(decimal(accounting.quantity).toFixed(8), '0.00150000');
  assert.equal(decimal(accounting.averageCostBrl ?? 0).toFixed(2), '400000.00');
  assert.equal(decimal(accounting.realizedPnlBrl).toFixed(2), '50.00');
  assert.equal(decimal(accounting.feesBrl).toFixed(2), '4.00');
});

test('BTC: venda total preserva resultado realizado com posição zerada', () => {
  const accounting = calculateAssetAccounting('BTC', [
    {
      asset: 'BTC',
      type: 'BUY',
      quantity: '0.001',
      cashAmountBrl: '300',
      costBasisKnown: true,
      date: new Date('2026-01-01'),
    },
    {
      asset: 'BTC',
      type: 'SELL',
      quantity: '0.001',
      cashAmountBrl: '350',
      costBasisKnown: true,
      date: new Date('2026-01-02'),
    },
  ]);
  assert.equal(decimal(accounting.quantity).toFixed(8), '0.00000000');
  assert.equal(decimal(accounting.realizedPnlBrl).toFixed(2), '50.00');
  assert.equal(accounting.averageCostBrl, null);
});

test('ajuste sem custo fica fora do P&L e marca resultado incompleto', () => {
  const accounting = calculateAssetAccounting('BTC', [
    {
      asset: 'BTC',
      type: 'MANUAL_ADJUSTMENT',
      quantity: '0.00000100',
      cashAmountBrl: '0',
      costBasisKnown: false,
      date: new Date('2026-01-01'),
    },
  ]);
  const enriched = enrichAccountingWithQuote(accounting, '500000');
  assert.equal(decimal(enriched.marketValueBrl).toFixed(2), '0.50');
  assert.equal(enriched.pnlComplete, false);
  assert.equal(decimal(enriched.totalPnlBrl).toFixed(2), '0.00');
});

test('USD usa a mesma contabilidade de preço médio', () => {
  const accounting = calculateAssetAccounting('USD', [
    {
      asset: 'USD',
      type: 'BUY',
      quantity: '100',
      cashAmountBrl: '500',
      costBasisKnown: true,
      date: new Date('2026-01-01'),
    },
    {
      asset: 'USD',
      type: 'BUY',
      quantity: '100',
      cashAmountBrl: '600',
      costBasisKnown: true,
      date: new Date('2026-01-02'),
    },
  ]);
  assert.equal(decimal(accounting.averageCostBrl ?? 0).toFixed(2), '5.50');
});
