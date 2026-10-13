import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request, Response } from 'express';

import { AUTH_COOKIE_NAME } from '@/lib/auth';
import { createLogoutHandler } from '@/lib/logout-handler';

function createResponse() {
  const state: {
    body?: unknown;
    clearedCookie?: string;
    statusCode?: number;
  } = {};
  const response = {
    clearCookie(name: string) {
      state.clearedCookie = name;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
    status(statusCode: number) {
      state.statusCode = statusCode;
      return response;
    },
    state,
  };
  return response;
}

test('logout reports failed revocation after clearing the local cookie', async () => {
  const request = {
    cookies: { [AUTH_COOKIE_NAME]: 'verified-token' },
    hostname: 'localhost',
    protocol: 'http',
  } as unknown as Request;
  const response = createResponse();
  const originalConsoleError = console.error;
  console.error = () => undefined;

  try {
    await createLogoutHandler(async () => {
      throw new Error('database unavailable');
    })(request, response as unknown as Response, () => undefined);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.state.clearedCookie, AUTH_COOKIE_NAME);
  assert.equal(response.state.statusCode, 503);
  assert.deepEqual(response.state.body, {
    code: 'LOGOUT_REVOCATION_FAILED',
    error:
      'Esta sessão foi encerrada neste navegador, mas não foi possível encerrar as outras sessões',
  });
});
