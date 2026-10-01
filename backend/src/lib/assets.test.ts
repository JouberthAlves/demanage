import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAssetDate, parseAssetTransactionValues } from '@/lib/assets';

function parseValues(
  asset: 'BTC' | 'USD',
  values: Partial<Parameters<typeof parseAssetTransactionValues>[1]> = {},
) {
  return parseAssetTransactionValues(asset, {
    type: 'BUY',
    quantity: '1',
    cashAmountBrl: '100',
    date: '2026-01-01',
    ...values,
  });
}

test('asset quantities respect the Prisma precision and asset scale', () => {
  assert.equal(parseValues('BTC', { quantity: '0.12345678' }).quantity.toString(), '0.12345678');
  assert.throws(() => parseValues('BTC', { quantity: '0.123456789' }), /precisão/);
  assert.equal(parseValues('USD', { quantity: '0.000000000001' }).quantity.toString(), '1e-12');
  assert.throws(() => parseValues('USD', { quantity: '0.0000000000001' }), /precisão/);
  assert.throws(() => parseValues('USD', { quantity: '1000000000000000000' }), /precisão/);
});

test('asset BRL and fee values respect their Prisma scale and integer width', () => {
  assert.throws(() => parseValues('BTC', { cashAmountBrl: '0.000000001' }), /precisão/);
  assert.throws(() => parseValues('BTC', { cashAmountBrl: '10000000000' }), /precisão/);
  assert.throws(() => parseValues('BTC', { feeAmountBrl: '1.000000001' }), /precisão/);
  assert.throws(() => parseValues('BTC', { feePercent: '10000.000000001' }), /precisão/);
  assert.throws(
    () => parseValues('BTC', { cashAmountBrl: '9999999999.99999999' }),
    /limite das movimentações/,
  );
  assert.equal(
    parseValues('BTC', {
      cashAmountBrl: '0.3',
      feePercent: '1.12345678',
    }).fee.toFixed(8),
    '0.00337037',
  );
  assert.throws(
    () =>
      parseValues('BTC', {
        cashAmountBrl: '9999999999.99',
        feePercent: '9999.99999999',
      }),
    /Taxa excede a precisão/,
  );
});

test('asset future-date validation uses the São Paulo civil day', () => {
  const afterMidnightUtc = new Date('2026-10-01T01:00:00.000Z');
  assert.equal(
    parseAssetDate('2026-09-30', afterMidnightUtc).toISOString(),
    '2026-09-30T12:00:00.000Z',
  );
  assert.throws(
    () => parseAssetDate('2026-10-01', afterMidnightUtc),
    /Data futura/,
  );
});
