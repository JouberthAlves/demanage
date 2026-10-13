import assert from 'node:assert/strict';
import test from 'node:test';

import { Prisma } from '@/generated/prisma/client';
import {
  parseAssetDate,
  parseAssetTransactionValues,
  serializeAssetTransaction,
} from '@/lib/asset-values';

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

test('asset dates are strict: 2026-02-30 is rejected, ISO timestamps still work', () => {
  const now = new Date('2026-10-10T12:00:00.000Z');
  assert.throws(() => parseAssetDate('2026-02-30', now), /Data inválida/);
  assert.throws(() => parseAssetDate('2026-02-30T10:00:00Z', now), /Data inválida/);
  assert.throws(() => parseAssetDate('not a date', now), /Data inválida/);
  assert.equal(
    parseAssetDate('2026-02-28T15:00:00.000Z', now).toISOString(),
    '2026-02-28T12:00:00.000Z',
  );
});

test('BRL cost basis is rounded once to cents before both writes', () => {
  const values = parseValues('BTC', { cashAmountBrl: '100.12345678' });
  assert.equal(values.cash.toFixed(), '100.12');
  assert.throws(() => parseValues('BTC', { cashAmountBrl: '0.004' }), /maior que zero/);
});

test('serialized asset transactions never contain exponent notation', () => {
  const serialized = serializeAssetTransaction({
    id: 't',
    userId: 'u',
    asset: 'USD',
    type: 'BUY',
    quantity: new Prisma.Decimal('0.000000000001'),
    cashAmountBrl: new Prisma.Decimal('1'),
    feeAmountBrl: new Prisma.Decimal('0.00000001'),
    feePercent: new Prisma.Decimal('0.00000001'),
    costBasisKnown: true,
    date: new Date('2026-01-01T12:00:00.000Z'),
    note: null,
    expenseId: null,
    entryId: null,
    createdAt: new Date('2026-01-01T12:00:00.000Z'),
  } as unknown as Parameters<typeof serializeAssetTransaction>[0]);
  assert.equal(serialized.quantity, '0.000000000001');
  assert.equal(serialized.feeAmountBrl, '0.00000001');
  assert.equal(serialized.feePercent, '0.00000001');
});
