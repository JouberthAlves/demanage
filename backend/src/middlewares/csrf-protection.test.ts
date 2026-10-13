/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';

import { AUTH_COOKIE_NAME } from '@/lib/auth';
import { createCsrfProtection } from '@/middlewares/csrf-protection';

function runMiddleware(options: {
  method?: string;
  cookie?: string;
  origin?: string;
  referer?: string;
}) {
  let nextCalled = false;
  let statusCode: number | undefined;
  let responseBody: unknown;
  const headers: Record<string, string | undefined> = {
    origin: options.origin,
    referer: options.referer,
  };
  const req = {
    method: options.method ?? 'POST',
    cookies: options.cookie ? { [AUTH_COOKIE_NAME]: options.cookie } : {},
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    },
  } as unknown as Response;

  createCsrfProtection((origin) => origin === 'https://app.example')(
    req,
    res,
    (() => {
      nextCalled = true;
    }) as NextFunction,
  );

  return { nextCalled, statusCode, responseBody };
}

test('unsafe cookie-authenticated requests reject cross-site and missing origins', () => {
  const crossSite = runMiddleware({
    cookie: 'session',
    origin: 'https://attacker.example',
    referer: 'https://app.example/account',
  });
  assert.equal(crossSite.nextCalled, false);
  assert.equal(crossSite.statusCode, 403);

  const noOrigin = runMiddleware({ cookie: 'session' });
  assert.equal(noOrigin.nextCalled, false);
  assert.equal(noOrigin.statusCode, 403);
});

test('unsafe cookie-authenticated requests accept the configured origin or same-origin referer', () => {
  const trustedOrigin = runMiddleware({
    cookie: 'session',
    origin: 'https://app.example',
  });
  assert.equal(trustedOrigin.nextCalled, true);

  const trustedReferer = runMiddleware({
    cookie: 'session',
    referer: 'https://app.example/expenses?month=2026-09',
  });
  assert.equal(trustedReferer.nextCalled, true);
});

test('safe reads and requests without an auth cookie remain available', () => {
  assert.equal(
    runMiddleware({
      method: 'GET',
      cookie: 'session',
      origin: 'https://attacker.example',
    }).nextCalled,
    true,
  );
  assert.equal(
    runMiddleware({
      cookie: undefined,
      origin: 'https://attacker.example',
    }).nextCalled,
    true,
  );
});
