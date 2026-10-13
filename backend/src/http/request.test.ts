/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request } from 'express';

import { AppError } from './errors';
import {
  bodyOf,
  parseAssetParam,
  parseBoolean,
  parseOptionalNote,
  parsePatchNote,
  queryString,
  requireUserId,
} from './request';

const asReq = (value: object) => value as unknown as Request;

function status(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error.status;
    throw error;
  }
  return null;
}

test('bodyOf tolerates a missing body and rejects non-objects', () => {
  assert.deepEqual(bodyOf(asReq({ body: undefined })), {});
  assert.deepEqual(bodyOf(asReq({ body: null })), {});
  assert.deepEqual(bodyOf(asReq({ body: { a: 1 } })), { a: 1 });
  assert.equal(
    status(() => bodyOf(asReq({ body: [1] }))),
    400,
  );
  assert.equal(
    status(() => bodyOf(asReq({ body: 'x' }))),
    400,
  );
});

test('requireUserId returns the authenticated id or throws 401', () => {
  assert.equal(requireUserId(asReq({ user: { id: 'u1' } })), 'u1');
  assert.equal(
    status(() => requireUserId(asReq({}))),
    401,
  );
});

test('parseBoolean is strict instead of coercing with Boolean()', () => {
  assert.equal(parseBoolean(undefined, 'f'), undefined);
  assert.equal(parseBoolean(null, 'f'), undefined);
  assert.equal(parseBoolean(true, 'f'), true);
  assert.equal(parseBoolean(false, 'f'), false);
  assert.equal(parseBoolean('false', 'f'), false);
  assert.equal(parseBoolean('true', 'f'), true);
  for (const bad of ['yes', 'FALSE', 0, 1, [], {}]) {
    assert.equal(
      status(() => parseBoolean(bad, 'f')),
      400,
      String(bad),
    );
  }
});

test('notes are sanitized, truncated and type-checked', () => {
  assert.equal(parseOptionalNote(undefined), null);
  assert.equal(parseOptionalNote(null), null);
  assert.equal(parseOptionalNote('   '), null);
  assert.equal(parseOptionalNote('  oi  '), 'oi');
  assert.equal(parseOptionalNote('x'.repeat(600))?.length, 500);
  assert.equal(
    status(() => parseOptionalNote(42)),
    400,
  );
  assert.equal(parsePatchNote(undefined), undefined);
  assert.equal(parsePatchNote(null), null);
  assert.equal(parsePatchNote('ok'), 'ok');
});

test('asset params are case-insensitive and validated', () => {
  assert.equal(parseAssetParam(asReq({ params: { asset: 'btc' } })), 'BTC');
  assert.equal(parseAssetParam(asReq({ params: { asset: 'USD' } })), 'USD');
  assert.equal(
    status(() => parseAssetParam(asReq({ params: { asset: 'eth' } }))),
    400,
  );
});

test('queryString rejects repeated parameters', () => {
  assert.equal(queryString(asReq({ query: {} }), 'a'), undefined);
  assert.equal(queryString(asReq({ query: { a: 'x' } }), 'a'), 'x');
  assert.equal(
    status(() => queryString(asReq({ query: { a: ['x', 'y'] } }), 'a')),
    400,
  );
});
