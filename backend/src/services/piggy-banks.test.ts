/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/http/errors';

import {
  parseCdiPercent,
  parseCreatePiggy,
  parseMoneyMovement,
  parseUpdatePiggy,
} from './piggy-banks';

function status(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.status;
    throw error;
  }
  return null;
}

test('flags are strict booleans, not truthy coercions', () => {
  const parsed = parseCreatePiggy({
    name: 'Reserva',
    autoDebit: 'false',
    yieldEnabled: false,
    isEmergency: 'true',
  });
  assert.equal(parsed.autoDebit, false);
  assert.equal(parsed.yieldEnabled, false);
  assert.equal(parsed.isEmergency, true);

  assert.equal(
    status(() => parseCreatePiggy({ name: 'x', autoDebit: 'nope' })),
    400,
  );
  assert.equal(
    status(() => parseUpdatePiggy({ yieldEnabled: 1 })),
    400,
  );
  assert.equal(parseUpdatePiggy({}).autoDebit, undefined);
});

test('create and update inputs validate names, goals and CDI', () => {
  assert.equal(
    status(() => parseCreatePiggy({})),
    400,
  );
  assert.equal(
    status(() => parseCreatePiggy({ name: 'x', goalAmount: '0' })),
    400,
  );
  assert.equal(
    parseCreatePiggy({ name: 'x', goalAmount: '' }).goalAmount,
    null,
  );
  assert.equal(parseUpdatePiggy({ goalAmount: null }).goalAmount, null);
  assert.equal(parseUpdatePiggy({}).goalAmount, undefined);
  assert.equal(parseCdiPercent(undefined), 0);
  assert.equal(parseCdiPercent('110.123456'), 110.1235);
  assert.equal(
    status(() => parseCdiPercent(1001)),
    400,
  );
  assert.equal(
    status(() => parseCdiPercent({})),
    400,
  );
});

test('money movements need a positive amount and a text note', () => {
  assert.deepEqual(parseMoneyMovement({ amount: '10', note: ' oi ' }), {
    amount: 10,
    note: 'oi',
  });
  assert.equal(
    status(() => parseMoneyMovement({ amount: 0 })),
    400,
  );
  assert.equal(
    status(() => parseMoneyMovement({ amount: 1, note: 3 })),
    400,
  );
});
