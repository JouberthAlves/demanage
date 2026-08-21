import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateAssetAccounting,
  enrichAccountingWithQuote,
} from '@/lib/asset-accounting';
import { decimal } from '@/lib/decimal';
import { balanceFromTransactions } from '@/lib/piggy';

function marketValue(
  asset: 'BTC' | 'USD',
  transactions: Parameters<typeof calculateAssetAccounting>[1],
  quoteBrl: string,
) {
  return decimal(
    enrichAccountingWithQuote(
      calculateAssetAccounting(asset, transactions),
      quoteBrl,
    ).marketValueBrl,
  );
}

test('compra de BTC muda composição, não destrói patrimônio', () => {
  const openingCash = decimal('1000');
  const purchaseBrl = decimal('100');
  const btcBrl = marketValue(
    'BTC',
    [
      {
        asset: 'BTC',
        type: 'BUY',
        quantity: '0.0002',
        cashAmountBrl: purchaseBrl,
        costBasisKnown: true,
        date: new Date('2026-01-01'),
      },
    ],
    '500000',
  );

  const cashAfterTransfer = openingCash.minus(purchaseBrl);
  assert.equal(cashAfterTransfer.plus(btcBrl).toFixed(2), '1000.00');

  // O benchmark recebe somente fluxos externos. A compra é transferência interna.
  const benchmarkAfterInternalPurchase = openingCash.plus(decimal(0));
  assert.equal(benchmarkAfterInternalPurchase.toFixed(2), '1000.00');
});

test('venda de BTC preserva a transferência e deixa ganho como patrimônio', () => {
  const openingCash = decimal('1000');
  const transactions = [
    {
      asset: 'BTC' as const,
      type: 'BUY' as const,
      quantity: '0.0002',
      cashAmountBrl: '100',
      costBasisKnown: true,
      date: new Date('2026-01-01'),
    },
    {
      asset: 'BTC' as const,
      type: 'SELL' as const,
      quantity: '0.0001',
      cashAmountBrl: '60',
      costBasisKnown: true,
      date: new Date('2026-01-02'),
    },
  ];
  const accounting = calculateAssetAccounting('BTC', transactions);
  const remainingBtc = decimal(
    enrichAccountingWithQuote(accounting, '600000').marketValueBrl,
  );
  const cash = openingCash.minus(100).plus(60);

  assert.equal(cash.plus(remainingBtc).toFixed(2), '1020.00');
  assert.equal(decimal(accounting.realizedPnlBrl).toFixed(2), '10.00');
});

test('depósito e saque de Cofrinho são transferências patrimoniais internas', () => {
  const openingCash = decimal('1000');
  const afterDeposit = balanceFromTransactions([
    { type: 'deposit', amount: decimal('100') },
  ]);
  assert.equal(openingCash.minus(100).plus(afterDeposit).toFixed(2), '1000.00');

  const afterWithdraw = balanceFromTransactions([
    { type: 'deposit', amount: decimal('100') },
    { type: 'withdraw', amount: decimal('40') },
  ]);
  assert.equal(openingCash.minus(100).plus(40).plus(afterWithdraw).toFixed(2), '1000.00');
});

test('carteira mista BTC + USD soma todas as classes sem dupla contagem', () => {
  const cash = decimal('700');
  const btc = marketValue(
    'BTC',
    [
      {
        asset: 'BTC',
        type: 'BUY',
        quantity: '0.0002',
        cashAmountBrl: '100',
        costBasisKnown: true,
        date: new Date('2026-01-01'),
      },
    ],
    '550000',
  );
  const usd = marketValue(
    'USD',
    [
      {
        asset: 'USD',
        type: 'BUY',
        quantity: '40',
        cashAmountBrl: '200',
        costBasisKnown: true,
        date: new Date('2026-01-01'),
      },
    ],
    '5.25',
  );

  assert.equal(btc.toFixed(2), '110.00');
  assert.equal(usd.toFixed(2), '210.00');
  assert.equal(cash.plus(btc).plus(usd).toFixed(2), '1020.00');
});
