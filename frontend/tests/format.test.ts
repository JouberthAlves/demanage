import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCardExpiryInput,
  CARD_EXPIRY_ERROR,
  cardExpiryError,
  formatBrlInputValue,
  formatCardExpiry,
  formatCurrency,
  isCardExpired,
  maskBrlInput,
  maskClosingDayInput,
  normalizeClosingDayInput,
  parseCardExpiryInput,
  parseCurrencyInput,
} from '@/lib/format';

/** Intl puts a non-breaking space after "R$"; compare with plain spaces. */
function plainSpaces(value: string) {
  return value.replace(/\s/g, ' ');
}

test('formatBrlInputValue writes pt-BR numbers with two decimals', () => {
  assert.equal(formatBrlInputValue(1234.5), '1.234,50');
  assert.equal(formatBrlInputValue(0), '0,00');
  assert.equal(formatBrlInputValue(Number.NaN), '');
  assert.equal(formatBrlInputValue(Number.POSITIVE_INFINITY), '');
});

test('formatCurrency renders BRL and treats non-finite values as zero', () => {
  assert.equal(plainSpaces(formatCurrency(1234.5)), 'R$ 1.234,50');
  assert.equal(plainSpaces(formatCurrency(Number.NaN)), 'R$ 0,00');
});

test('maskBrlInput fills cents from the right as the user types', () => {
  assert.equal(maskBrlInput(''), '');
  assert.equal(maskBrlInput('5'), '0,05');
  assert.equal(maskBrlInput('150'), '1,50');
  assert.equal(maskBrlInput('123456'), '1.234,56');
  assert.equal(maskBrlInput('R$ 1.234,5'), '123,45');
});

test('maskBrlInput caps the value at 12 digits (R$ 9.999.999.999,99)', () => {
  assert.equal(maskBrlInput('9999999999999'), '9.999.999.999,99');
});

test('parseCurrencyInput reads the masked value back as a number', () => {
  assert.equal(parseCurrencyInput(''), 0);
  assert.equal(parseCurrencyInput('0,05'), 0.05);
  assert.equal(parseCurrencyInput('1.234,56'), 1234.56);
  assert.equal(parseCurrencyInput(maskBrlInput('987654')), 9876.54);
});

test('applyCardExpiryInput masks MM/AA while typing', () => {
  assert.deepEqual(applyCardExpiryInput(''), { value: '' });
  assert.deepEqual(applyCardExpiryInput('0'), { value: '0' });
  assert.deepEqual(applyCardExpiryInput('05'), { value: '05' });
  assert.deepEqual(applyCardExpiryInput('052'), { value: '05/2' });
  assert.deepEqual(applyCardExpiryInput('0526'), { value: '05/26' });
  assert.deepEqual(applyCardExpiryInput('0526999'), { value: '05/26' });
});

test('applyCardExpiryInput drops the keystroke that makes the month invalid', () => {
  const tooHigh = applyCardExpiryInput('13');
  assert.equal(tooHigh.value, '1');
  assert.ok(tooHigh.error);

  const zero = applyCardExpiryInput('00');
  assert.equal(zero.value, '0');
  assert.ok(zero.error);
});

test('parseCardExpiryInput resolves MM/AA to the last instant of that month', () => {
  const parsed = parseCardExpiryInput('05/26');
  assert.ok(parsed);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 4);
  assert.equal(parsed.getDate(), 31);
  assert.equal(parsed.getHours(), 23);
  assert.equal(parsed.getMinutes(), 59);
});

test('parseCardExpiryInput rejects incomplete and out-of-range values', () => {
  assert.equal(parseCardExpiryInput(''), null);
  assert.equal(parseCardExpiryInput('5/2'), null);
  assert.equal(parseCardExpiryInput('13/26'), null);
  assert.equal(parseCardExpiryInput('00/26'), null);
});

test('cardExpiryError allows an empty expiry and flags partial or invalid ones', () => {
  assert.equal(cardExpiryError(''), null);
  assert.equal(cardExpiryError('   '), null);
  assert.equal(cardExpiryError('05/26'), null);
  assert.equal(cardExpiryError('5/2'), CARD_EXPIRY_ERROR);
  assert.equal(cardExpiryError('13/26'), CARD_EXPIRY_ERROR);
});

test('formatCardExpiry shows MM/AA and ignores missing or invalid dates', () => {
  assert.equal(formatCardExpiry(new Date(2026, 4, 31).toISOString()), '05/26');
  assert.equal(formatCardExpiry(new Date(2031, 0, 15).toISOString()), '01/31');
  assert.equal(formatCardExpiry(null), '');
  assert.equal(formatCardExpiry(undefined), '');
  assert.equal(formatCardExpiry('not-a-date'), '');
});

test('formatCardExpiry round-trips with parseCardExpiryInput', () => {
  const parsed = parseCardExpiryInput('11/28');
  assert.ok(parsed);
  assert.equal(formatCardExpiry(parsed.toISOString()), '11/28');
});

test('isCardExpired compares the expiry with the current time', () => {
  assert.equal(isCardExpired('2000-01-01T00:00:00.000Z'), true);
  assert.equal(isCardExpired('2999-01-01T00:00:00.000Z'), false);
  assert.equal(isCardExpired(undefined), false);
  assert.equal(isCardExpired(null), false);
  assert.equal(isCardExpired('not-a-date'), false);
});

test('maskClosingDayInput keeps at most two digits in the 1-31 range', () => {
  assert.equal(maskClosingDayInput(''), '');
  assert.equal(maskClosingDayInput('5'), '5');
  assert.equal(maskClosingDayInput('05'), '05');
  assert.equal(maskClosingDayInput('123'), '12');
  assert.equal(maskClosingDayInput('abc'), '');
  assert.equal(maskClosingDayInput('00'), '');
  assert.equal(maskClosingDayInput('32'), '3');
});

test('normalizeClosingDayInput pads a single digit and rejects 0', () => {
  assert.equal(normalizeClosingDayInput('5'), '05');
  assert.equal(normalizeClosingDayInput('31'), '31');
  assert.equal(normalizeClosingDayInput(''), '');
  assert.equal(normalizeClosingDayInput('0'), '');
  assert.equal(normalizeClosingDayInput('00'), '');
});
