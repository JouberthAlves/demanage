import assert from 'node:assert/strict';
import test from 'node:test';

import {
  btcToSats,
  convertBtcInput,
  formatAssetQuantity,
  normalizeBtcQuantity,
  satsToBtc,
} from '@/lib/btc-quantity';

test('btcToSats is exact where floats are not', () => {
  assert.equal(Number('1.23456789') * 100_000_000 === 123456789, false);
  assert.equal(btcToSats('1.23456789'), '123456789');
  assert.equal(btcToSats('0.00000001'), '1');
  assert.equal(btcToSats('21000000'), '2100000000000000');
  assert.equal(btcToSats('0.5'), '50000000');
  assert.equal(btcToSats('-0.0005'), '-50000');
});

test('btcToSats rounds half up at the 8th decimal and bounds safe integers', () => {
  assert.equal(btcToSats('0.000000015'), '2');
  assert.equal(btcToSats('0.000000014'), '1');
  assert.equal(btcToSats('999999999999'), null);
  assert.equal(btcToSats('abc'), null);
});

test('satsToBtc trims zeros', () => {
  assert.equal(satsToBtc('100000000'), '1');
  assert.equal(satsToBtc('1000411'), '0.01000411');
  assert.equal(satsToBtc('1'), '0.00000001');
  assert.equal(satsToBtc('-50000'), '-0.0005');
});

test('normalizeBtcQuantity accepts pt-BR input in both units', () => {
  assert.equal(normalizeBtcQuantity('0,01000411', 'BTC'), '0.01000411');
  assert.equal(normalizeBtcQuantity('1.234,5', 'BTC'), '1234.5');
  assert.equal(normalizeBtcQuantity('1.000.411', 'SATS'), '0.01000411');
  assert.equal(normalizeBtcQuantity('1000411', 'SATS'), '0.01000411');
  assert.equal(normalizeBtcQuantity('', 'BTC'), null);
  assert.equal(normalizeBtcQuantity('0', 'SATS'), null);
  assert.equal(normalizeBtcQuantity('0,000000001', 'BTC'), null);
  assert.equal(normalizeBtcQuantity('1,5', 'SATS'), '0.00000015');
});

test('switching BTC -> sats keeps 1.23456789 BTC (no float drift)', () => {
  assert.equal(convertBtcInput('1,23456789', 'BTC', 'SATS'), '123456789');
  assert.equal(convertBtcInput('0,01000411', 'BTC', 'SATS'), '1000411');
  assert.equal(convertBtcInput('123456789', 'SATS', 'BTC'), '1,23456789');
  assert.equal(convertBtcInput('lixo', 'BTC', 'SATS'), '');
});

test('formatAssetQuantity shows small BTC as sats', () => {
  assert.equal(formatAssetQuantity('BTC', '0.00012345'), '12.345 sats');
  assert.match(formatAssetQuantity('BTC', '1.5'), /^1,5 BTC$/);
  assert.match(formatAssetQuantity('USD', '100'), /^100 USD$/);
});
