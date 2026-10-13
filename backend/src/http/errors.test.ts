/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';

import { Prisma } from '@/generated/prisma/client';
import { AssetValidationError } from '@/lib/assets';
import { CodedError, DomainError, PiggyError } from '@/lib/errors';
import { ExpenseSplitError } from '@/lib/expense-splits';
import { MarketDataError } from '@/lib/market-data';
import { PatrimonyError } from '@/lib/patrimony';

import {
  AppError,
  badRequest,
  conflict,
  errorHandler,
  isUniqueViolation,
  notFound,
  orUnavailable,
  resolveHttpError,
  serviceUnavailable,
  unauthorized,
} from './errors';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });
}

test('AppError helpers carry status, message and code', () => {
  assert.deepEqual(resolveHttpError(badRequest('x')), {
    status: 400,
    body: { error: 'x' },
  });
  assert.equal(resolveHttpError(unauthorized()).status, 401);
  assert.equal(resolveHttpError(notFound('n')).status, 404);
  assert.deepEqual(resolveHttpError(conflict('c', 'DUP')), {
    status: 409,
    body: { error: 'c', code: 'DUP' },
  });
  assert.equal(resolveHttpError(serviceUnavailable('s')).status, 503);
  assert.equal(new AppError(418, 'teapot').status, 418);
});

test('body-parser errors map to 400 and 413 instead of 500', () => {
  const malformed = Object.assign(new SyntaxError('Unexpected token'), {
    status: 400,
    statusCode: 400,
    type: 'entity.parse.failed',
    expose: true,
  });
  assert.deepEqual(resolveHttpError(malformed), {
    status: 400,
    body: { error: 'JSON inválido' },
  });

  const tooLarge = Object.assign(new Error('request entity too large'), {
    status: 413,
    statusCode: 413,
    type: 'entity.too.large',
  });
  assert.equal(resolveHttpError(tooLarge).status, 413);

  const unsupported = Object.assign(new Error('bad charset'), {
    status: 415,
    type: 'charset.unsupported',
  });
  assert.equal(resolveHttpError(unsupported).status, 415);
});

test('prisma unique and not-found errors map to 409 and 404', () => {
  assert.equal(resolveHttpError(prismaError('P2002')).status, 409);
  assert.equal(resolveHttpError(prismaError('P2025')).status, 404);
  assert.equal(resolveHttpError(prismaError('P2034')).status, 500);
  assert.equal(isUniqueViolation(prismaError('P2002')), true);
  assert.equal(isUniqueViolation(new Error('P2002')), false);
});

test('lib domain errors are mapped by class, not by message', () => {
  assert.equal(resolveHttpError(new ExpenseSplitError('qualquer')).status, 400);
  assert.equal(
    resolveHttpError(new AssetValidationError('qualquer')).status,
    400,
  );
  assert.equal(resolveHttpError(new PatrimonyError('qualquer')).status, 400);
  assert.deepEqual(resolveHttpError(new MarketDataError('provedor fora')), {
    status: 503,
    body: { error: 'provedor fora' },
  });
  // Mesma mensagem em um Error genérico não ganha semântica HTTP.
  assert.equal(resolveHttpError(new Error('NOT_FOUND')).status, 500);
});

test('unknown errors are a generic 500 without leaking details', () => {
  assert.deepEqual(resolveHttpError(new Error('secret detail')), {
    status: 500,
    body: { error: 'Internal server error' },
  });
  assert.equal(resolveHttpError('string').status, 500);
  assert.equal(resolveHttpError(null).status, 500);
});

test('orUnavailable keeps known errors and wraps unexpected ones in 503', async () => {
  await assert.rejects(
    () =>
      orUnavailable('indisponível', async () => {
        throw badRequest('entrada ruim');
      }),
    (error: unknown) => error instanceof AppError && error.status === 400,
  );
  await assert.rejects(
    () =>
      orUnavailable('indisponível', async () => {
        throw new PatrimonyError('data inválida');
      }),
    PatrimonyError,
  );
  const cause = new Error('socket hang up');
  await assert.rejects(
    () =>
      orUnavailable('indisponível', async () => {
        throw cause;
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.status === 503 &&
      error.message === 'indisponível' &&
      error.cause === cause,
  );
  assert.equal(await orUnavailable('x', async () => 7), 7);
});

test('errorHandler writes the mapped JSON response and delegates after headers', () => {
  const sent: { status?: number; body?: unknown } = {};
  const res = {
    headersSent: false,
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: unknown) {
      sent.body = body;
      return this;
    },
  } as unknown as Response;

  errorHandler(conflict('duplicado'), {} as Request, res, () => {
    assert.fail('next must not be called');
  });
  assert.equal(sent.status, 409);
  assert.deepEqual(sent.body, { error: 'duplicado' });

  let delegated: unknown;
  const late = { headersSent: true } as unknown as Response;
  const error = new Error('late');
  errorHandler(error, {} as Request, late, (value?: unknown) => {
    delegated = value;
  });
  assert.equal(delegated, error);
});

test('piggy errors map by class and code; coded errors never leak', () => {
  assert.deepEqual(resolveHttpError(new PiggyError('NOT_FOUND')), {
    status: 404,
    body: { error: 'Cofre não encontrado' },
  });
  assert.equal(
    resolveHttpError(new PiggyError('INSUFFICIENT_BALANCE')).status,
    400,
  );
  assert.equal(
    resolveHttpError(new PiggyError('PAST_TARGET_DATE')).status,
    400,
  );
  assert.equal(resolveHttpError(new PiggyError('UNMAPPED')).status, 500);
  assert.equal(resolveHttpError(new CodedError('SOME_CODE')).status, 500);
  assert.deepEqual(resolveHttpError(new DomainError('Mensagem de negócio')), {
    status: 400,
    body: { error: 'Mensagem de negócio' },
  });
});
