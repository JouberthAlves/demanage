import assert from 'node:assert/strict';
import test from 'node:test';

import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useFinanceStore } from '@/stores/finance-store';
import type { AuthUser } from '@/types/auth';

function user(id: string): AuthUser {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    hasRecoveryCode: true,
    salary: 0,
    salaryReceiveDay: null,
    notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function response(
  config: InternalAxiosRequestConfig,
  data: unknown,
): AxiosResponse {
  return {
    config,
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
  };
}

test('logout and login isolate the account and reset financial state', async () => {
  const originalAdapter = api.defaults.adapter;

  try {
    api.defaults.adapter = async (config) => {
      if (config.url === '/auth/login') {
        const credentials = JSON.parse(String(config.data)) as { email: string };
        const id = credentials.email.startsWith('a@') ? 'a' : 'b';
        return response(config, { user: user(id) });
      }
      if (config.url === '/auth/logout') {
        return response(config, { ok: true });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    };

    await useAuthStore.getState().login('a@example.com', 'password');
    const revisionA = useAuthStore.getState().sessionRevision;

    useFinanceStore.getState().setIncomes([
      { id: 'private-income', name: 'Private', amount: 999, type: 'outro', frequency: 'unica' },
    ]);
    assert.equal(useFinanceStore.getState().incomes.length, 1);

    await useAuthStore.getState().logout();
    const revisionAfterLogout = useAuthStore.getState().sessionRevision;
    assert.ok(revisionAfterLogout > revisionA);
    assert.equal(useFinanceStore.getState().incomes.length, 0);
    assert.equal(useAuthStore.getState().user, null);

    await useAuthStore.getState().login('b@example.com', 'password');
    assert.ok(useAuthStore.getState().sessionRevision > revisionAfterLogout);
    assert.equal(useAuthStore.getState().user?.id, 'b');
    assert.equal(useFinanceStore.getState().incomes.length, 0);
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
    useFinanceStore.getState().clearAll();
  }
});

test('late auth/me from the previous user cannot overwrite a new login', async () => {
  const originalAdapter = api.defaults.adapter;
  let resolvePreviousMe: ((value: AxiosResponse) => void) | undefined;

  try {
    useAuthStore.getState().setUser(null);
    api.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        return new Promise<AxiosResponse>((resolve) => {
          resolvePreviousMe = resolve;
        });
      }
      if (config.url === '/auth/login') {
        return response(config, { user: user('b') });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    };

    const pendingMe = useAuthStore.getState().fetchMe();
    await useAuthStore.getState().login('b@example.com', 'password');
    const revision = useAuthStore.getState().sessionRevision;
    assert.ok(resolvePreviousMe);
    resolvePreviousMe!(response({ url: '/auth/me', headers: {} } as InternalAxiosRequestConfig, { user: user('a') }));
    await pendingMe;

    assert.equal(useAuthStore.getState().user?.id, 'b');
    assert.equal(useAuthStore.getState().sessionRevision, revision);
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
  }
});

test('late auth/me cannot restore a session after logout', async () => {
  const originalAdapter = api.defaults.adapter;
  let resolvePreviousMe: ((value: AxiosResponse) => void) | undefined;

  try {
    useAuthStore.getState().setUser(user('a'));
    api.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        return new Promise<AxiosResponse>((resolve) => {
          resolvePreviousMe = resolve;
        });
      }
      if (config.url === '/auth/logout') return response(config, { ok: true });
      throw new Error(`Unexpected request: ${config.url}`);
    };

    const pendingMe = useAuthStore.getState().fetchMe();
    await useAuthStore.getState().logout();
    assert.ok(resolvePreviousMe);
    resolvePreviousMe!(response({ url: '/auth/me', headers: {} } as InternalAxiosRequestConfig, { user: user('a') }));
    await pendingMe;

    assert.equal(useAuthStore.getState().user, null);
    assert.equal(useAuthStore.getState().isAuthenticated, false);
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
  }
});

test('auth/me detecting a different account clears cached finance state', async () => {
  const originalAdapter = api.defaults.adapter;
  try {
    useAuthStore.getState().setUser(user('a'));
    const oldRevision = useAuthStore.getState().sessionRevision;
    useFinanceStore.getState().setIncomes([
      { id: 'a-income', name: 'Sensitive', amount: 42, type: 'outro', frequency: 'unica' },
    ]);

    api.defaults.adapter = async (config) =>
      response(config, { user: user('b') });

    await useAuthStore.getState().fetchMe();

    assert.equal(useAuthStore.getState().user?.id, 'b');
    assert.ok(useAuthStore.getState().sessionRevision > oldRevision);
    assert.deepEqual(useFinanceStore.getState().incomes, []);
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
    useFinanceStore.getState().clearAll();
  }
});
