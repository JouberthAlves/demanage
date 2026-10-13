import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import assert from 'node:assert/strict';
import test from 'node:test';

import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
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
  status = 200,
): AxiosResponse {
  return {
    config,
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {},
  };
}

/** A failed request as axios reports it: a network drop when `status` is omitted. */
function failure(config: InternalAxiosRequestConfig, status?: number) {
  if (status === undefined) {
    return new AxiosError('Network Error', 'ERR_NETWORK', config);
  }
  return new AxiosError(
    'Request failed',
    'ERR_BAD_RESPONSE',
    config,
    undefined,
    response(config, { error: 'boom' }, status),
  );
}

test('login and logout bump the session revision on every account change', async () => {
  const originalAdapter = api.defaults.adapter;

  try {
    api.defaults.adapter = async (config) => {
      if (config.url === '/auth/login') {
        const credentials = JSON.parse(String(config.data)) as {
          email: string;
        };
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

    await useAuthStore.getState().logout();
    const revisionAfterLogout = useAuthStore.getState().sessionRevision;
    assert.ok(revisionAfterLogout > revisionA);
    assert.equal(useAuthStore.getState().user, null);

    await useAuthStore.getState().login('b@example.com', 'password');
    assert.ok(useAuthStore.getState().sessionRevision > revisionAfterLogout);
    assert.equal(useAuthStore.getState().user?.id, 'b');
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
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
    resolvePreviousMe!(
      response({ url: '/auth/me', headers: {} } as InternalAxiosRequestConfig, {
        user: user('a'),
      }),
    );
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
    resolvePreviousMe!(
      response({ url: '/auth/me', headers: {} } as InternalAxiosRequestConfig, {
        user: user('a'),
      }),
    );
    await pendingMe;

    assert.equal(useAuthStore.getState().user, null);
    assert.equal(useAuthStore.getState().isAuthenticated, false);
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
  }
});

test('auth/me for a different account bumps the session revision', async () => {
  const originalAdapter = api.defaults.adapter;
  try {
    useAuthStore.getState().setUser(user('a'));
    const oldRevision = useAuthStore.getState().sessionRevision;

    api.defaults.adapter = async (config) =>
      response(config, { user: user('b') });

    await useAuthStore.getState().fetchMe();

    assert.equal(useAuthStore.getState().user?.id, 'b');
    assert.ok(useAuthStore.getState().sessionRevision > oldRevision);
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
  }
});

test('auth/me keeps the logged-in user on a network error', async () => {
  const originalAdapter = api.defaults.adapter;
  try {
    useAuthStore.getState().setUser(user('a'));
    const revision = useAuthStore.getState().sessionRevision;

    api.defaults.adapter = async (config) => {
      throw failure(config);
    };

    const result = await useAuthStore.getState().fetchMe();

    assert.equal(result?.id, 'a');
    assert.equal(useAuthStore.getState().user?.id, 'a');
    assert.equal(useAuthStore.getState().isAuthenticated, true);
    assert.equal(useAuthStore.getState().isLoading, false);
    assert.equal(useAuthStore.getState().sessionRevision, revision);
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
  }
});

test('auth/me keeps the logged-in user on a 500', async () => {
  const originalAdapter = api.defaults.adapter;
  try {
    useAuthStore.getState().setUser(user('a'));

    api.defaults.adapter = async (config) => {
      throw failure(config, 500);
    };

    await useAuthStore.getState().fetchMe();

    assert.equal(useAuthStore.getState().user?.id, 'a');
    assert.equal(useAuthStore.getState().isAuthenticated, true);
    assert.equal(useAuthStore.getState().isLoading, false);
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
  }
});

test('auth/me clears the logged-in user on a 401', async () => {
  const originalAdapter = api.defaults.adapter;
  try {
    useAuthStore.getState().setUser(user('a'));

    api.defaults.adapter = async (config) => {
      throw failure(config, 401);
    };

    const result = await useAuthStore.getState().fetchMe();

    assert.equal(result, null);
    assert.equal(useAuthStore.getState().user, null);
    assert.equal(useAuthStore.getState().isAuthenticated, false);
    assert.equal(useAuthStore.getState().isLoading, false);
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
  }
});
