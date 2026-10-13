import assert from 'node:assert/strict';
import test from 'node:test';

import {
  brlMaskToDecimalString,
  normalizePtBrDecimal,
  parsePtBrDecimal,
  toCents,
  toPtBrDecimalInput,
} from '@/lib/decimal-input';

test('parsePtBrDecimal handles thousand dots and comma decimals', () => {
  assert.equal(parsePtBrDecimal('1.500,00'), 1500);
  assert.equal(parsePtBrDecimal('1.234.567,89'), 1234567.89);
  assert.equal(parsePtBrDecimal('1500,5'), 1500.5);
  assert.equal(parsePtBrDecimal('0,20'), 0.2);
  assert.equal(parsePtBrDecimal(',5'), 0.5);
  assert.equal(parsePtBrDecimal('1.500'), 1500);
  assert.equal(parsePtBrDecimal('1.500.000'), 1500000);
  assert.equal(parsePtBrDecimal(' 100 '), 100);
});

test('parsePtBrDecimal keeps dot decimals that are not thousand groups', () => {
  assert.equal(parsePtBrDecimal('0.20'), 0.2);
  assert.equal(parsePtBrDecimal('100.5'), 100.5);
  assert.equal(parsePtBrDecimal('0.500'), 0.5);
  assert.equal(parsePtBrDecimal('12.34'), 12.34);
});

test('parsePtBrDecimal supports negatives and rejects garbage', () => {
  assert.equal(parsePtBrDecimal('-1.500,25'), -1500.25);
  assert.equal(parsePtBrDecimal(''), null);
  assert.equal(parsePtBrDecimal('abc'), null);
  assert.equal(parsePtBrDecimal('1,2,3'), null);
  assert.equal(parsePtBrDecimal('1.5.5'), null);
  assert.equal(parsePtBrDecimal('12.34,5'), null);
  assert.equal(parsePtBrDecimal('-'), null);
});

test('normalizePtBrDecimal returns an exact dot-decimal string', () => {
  assert.equal(normalizePtBrDecimal('1.500,00'), '1500.00');
  assert.equal(normalizePtBrDecimal('0,01000411'), '0.01000411');
  assert.equal(normalizePtBrDecimal('007'), '7');
  assert.equal(normalizePtBrDecimal('-0'), '0');
});

test('toPtBrDecimalInput shows a comma for API decimals', () => {
  assert.equal(toPtBrDecimalInput('0.2'), '0,2');
  assert.equal(toPtBrDecimalInput(112.5), '112,5');
  assert.equal(toPtBrDecimalInput(null), '');
});

test('brlMaskToDecimalString converts masked BRL exactly', () => {
  assert.equal(brlMaskToDecimalString('1.234,56'), '1234.56');
  assert.equal(brlMaskToDecimalString('0,05'), '0.05');
  assert.equal(brlMaskToDecimalString('5'), '0.05');
  assert.equal(brlMaskToDecimalString(''), null);
});

test('toCents rounds API money strings to integer cents', () => {
  assert.equal(toCents('0.1') + toCents('0.2'), 30);
  assert.equal(toCents('19.99'), 1999);
  assert.equal(toCents(null), 0);
});
