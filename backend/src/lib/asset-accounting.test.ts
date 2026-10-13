import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAssetAccounting,
  enrichAccountingWithQuote,
  isAssetTimelineValid,
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

test('uma venda retroativa inválida é rejeitada pela timeline completa', () => {
  assert.equal(
    isAssetTimelineValid([
      {
        id: 'buy',
        asset: 'BTC',
        type: 'BUY',
        quantity: '1',
        cashAmountBrl: '100',
        costBasisKnown: true,
        date: new Date('2026-02-01T12:00:00Z'),
      },
      {
        id: 'backdated-sell',
        asset: 'BTC',
        type: 'SELL',
        quantity: '1.01',
        cashAmountBrl: '100',
        costBasisKnown: true,
        date: new Date('2026-01-31T12:00:00Z'),
      },
    ]),
    false,
  );
});

test('ordem no mesmo dia usa a sequência criada, não o UUID', () => {
  assert.equal(
    isAssetTimelineValid([
      {
        id: 'a-sale',
        createdAt: new Date('2026-02-01T12:01:00Z'),
        asset: 'BTC',
        type: 'SELL',
        quantity: '1',
        cashAmountBrl: '100',
        costBasisKnown: true,
        date: new Date('2026-02-01T12:00:00Z'),
      },
      {
        id: 'z-buy',
        createdAt: new Date('2026-02-01T12:00:00Z'),
        asset: 'BTC',
        type: 'BUY',
        quantity: '1',
        cashAmountBrl: '100',
        costBasisKnown: true,
        date: new Date('2026-02-01T12:00:00Z'),
      },
    ]),
    true,
  );
});

test('full exit leaves no residue: quantity, cost basis and average cost all go to zero', () => {
  const accounting = calculateAssetAccounting('BTC', [
    {
      asset: 'BTC',
      type: 'BUY',
      quantity: '0.3',
      cashAmountBrl: '100',
      costBasisKnown: true,
      date: new Date('2026-01-01'),
    },
    {
      asset: 'BTC',
      type: 'BUY',
      quantity: '0.7',
      cashAmountBrl: '300',
      costBasisKnown: false,
      date: new Date('2026-01-02'),
    },
    {
      asset: 'BTC',
      type: 'SELL',
      quantity: '0.33333333',
      cashAmountBrl: '150',
      costBasisKnown: true,
      date: new Date('2026-01-03'),
    },
    {
      asset: 'BTC',
      type: 'SELL',
      quantity: '0.66666667',
      cashAmountBrl: '250',
      costBasisKnown: true,
      date: new Date('2026-01-04'),
    },
  ]);

  assert.equal(accounting.quantity, '0');
  assert.equal(accounting.knownQuantity, '0');
  assert.equal(accounting.unknownQuantity, '0');
  assert.equal(accounting.investedBrl, '0');
  assert.equal(accounting.averageCostBrl, null);
});

test('thirds never leave a 1e-20 sliver with a stale 100 BRL average cost', () => {
  const accounting = calculateAssetAccounting('USD', [
    {
      asset: 'USD',
      type: 'BUY',
      quantity: '1',
      cashAmountBrl: '100',
      costBasisKnown: true,
      date: new Date('2026-01-01'),
    },
    {
      asset: 'USD',
      type: 'BUY',
      quantity: '2',
      cashAmountBrl: '0',
      costBasisKnown: false,
      date: new Date('2026-01-02'),
    },
    {
      asset: 'USD',
      type: 'SELL',
      quantity: '1',
      cashAmountBrl: '10',
      costBasisKnown: true,
      date: new Date('2026-01-03'),
    },
    {
      asset: 'USD',
      type: 'SELL',
      quantity: '2',
      cashAmountBrl: '20',
      costBasisKnown: true,
      date: new Date('2026-01-04'),
    },
  ]);
  assert.equal(accounting.quantity, '0');
  assert.equal(accounting.investedBrl, '0');
  assert.equal(accounting.averageCostBrl, null);
  // Quantities stay exact multiples of 1e-12 after partial sales too.
  const partial = calculateAssetAccounting('USD', [
    {
      asset: 'USD',
      type: 'BUY',
      quantity: '1',
      cashAmountBrl: '100',
      costBasisKnown: true,
      date: new Date('2026-01-01'),
    },
    {
      asset: 'USD',
      type: 'BUY',
      quantity: '2',
      cashAmountBrl: '0',
      costBasisKnown: false,
      date: new Date('2026-01-02'),
    },
    {
      asset: 'USD',
      type: 'SELL',
      quantity: '1',
      cashAmountBrl: '10',
      costBasisKnown: true,
      date: new Date('2026-01-03'),
    },
  ]);
  assert.equal(partial.knownQuantity, '0.666666666667');
  assert.equal(partial.unknownQuantity, '1.333333333333');
  assert.ok(!partial.quantity.includes('e'));
});

test('tiny quantities are serialised without exponent notation', () => {
  const accounting = calculateAssetAccounting('USD', [
    {
      asset: 'USD',
      type: 'BUY',
      quantity: '0.000000000001',
      cashAmountBrl: '0.01',
      costBasisKnown: true,
      date: new Date('2026-01-01'),
    },
  ]);
  assert.equal(accounting.quantity, '0.000000000001');
  assert.equal(accounting.knownQuantity, '0.000000000001');
});
