import { type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import assert from 'node:assert/strict';
import test from 'node:test';

import { api } from '@/lib/api';
import { AUTH_SESSION_EVENT_KEY } from '@/stores/auth-session-sync';
import { startAuthSessionSync, useAuthStore } from '@/stores/auth-store';
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
  return { config, data, status: 200, statusText: 'OK', headers: {} };
}

function fakeTab() {
  let listener: ((event: StorageEvent) => void) | undefined;
  const writes: string[] = [];
  const fakeWindow = {
    addEventListener: (
      name: string,
      callback: (event: StorageEvent) => void,
    ) => {
      if (name === 'storage') listener = callback;
    },
    removeEventListener: (name: string) => {
      if (name === 'storage') listener = undefined;
    },
    localStorage: {
      setItem: (key: string, value: string) => {
        assert.equal(key, AUTH_SESSION_EVENT_KEY);
        writes.push(value);
      },
    },
  };
  return {
    writes,
    fakeWindow,
    dispatch: (key = AUTH_SESSION_EVENT_KEY) => {
      assert.ok(listener, 'event listener installed');
      listener({ key, newValue: 'event-from-other-tab' } as StorageEvent);
    },
  };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('logout in another tab invalidates financial session before /auth/me resolves', async () => {
  const originalWindow = globalThis.window;
  const originalAdapter = api.defaults.adapter;
  const tab = fakeTab();
  Object.assign(globalThis, { window: tab.fakeWindow });
  let finishMe!: (result: AxiosResponse) => void;
  try {
    useAuthStore.getState().setUser(user('a'));
    api.defaults.adapter = () =>
      new Promise((resolve) => {
        finishMe = resolve;
      });
    const unsubscribe = startAuthSessionSync();
    const oldRevision = useAuthStore.getState().sessionRevision;
    tab.dispatch('irrelevant-storage-key');
    assert.equal(useAuthStore.getState().sessionRevision, oldRevision);
    tab.dispatch();
    assert.equal(useAuthStore.getState().user, null);
    assert.equal(useAuthStore.getState().isAuthenticated, false);
    assert.ok(
      useAuthStore.getState().sessionRevision > oldRevision,
      'App remounts QueryClient and drops financial cache',
    );
    assert.equal(tab.writes.length, 0, 'no echo to the originating tab');
    await tick();
    assert.ok(finishMe);
    finishMe(
      response({ url: '/auth/me', headers: {} } as InternalAxiosRequestConfig, {
        user: null,
      }),
    );
    await tick();
    assert.equal(useAuthStore.getState().user, null);
    unsubscribe();
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
    Object.assign(globalThis, { window: originalWindow });
  }
});

test('account switch across tabs drops old state and revalidates the shared cookie', async () => {
  const originalWindow = globalThis.window;
  const originalAdapter = api.defaults.adapter;
  const tab = fakeTab();
  Object.assign(globalThis, { window: tab.fakeWindow });
  try {
    useAuthStore.getState().setUser(user('a'));
    api.defaults.adapter = async (config) =>
      response(config, { user: user('b') });
    const unsubscribe = startAuthSessionSync();
    const revisionA = useAuthStore.getState().sessionRevision;
    tab.dispatch();
    assert.equal(useAuthStore.getState().user, null);
    await tick();
    assert.equal(useAuthStore.getState().user?.id, 'b');
    assert.ok(useAuthStore.getState().sessionRevision > revisionA);
    assert.equal(tab.writes.length, 0);
    unsubscribe();
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
    Object.assign(globalThis, { window: originalWindow });
  }
});

test('successful login and logout publish invalidation without exposing credentials', async () => {
  const originalWindow = globalThis.window;
  const originalAdapter = api.defaults.adapter;
  const tab = fakeTab();
  Object.assign(globalThis, { window: tab.fakeWindow });
  try {
    api.defaults.adapter = async (config) =>
      response(
        config,
        config.url === '/auth/login' ? { user: user('a') } : { ok: true },
      );
    await useAuthStore.getState().login('a@example.com', 'a-secret-password');
    await useAuthStore.getState().logout();
    assert.equal(tab.writes.length, 2);
    assert.notEqual(tab.writes[0], tab.writes[1]);
    assert.ok(
      tab.writes.every(
        (signal) =>
          !signal.includes('password') && !signal.includes('a@example.com'),
      ),
    );
  } finally {
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
    Object.assign(globalThis, { window: originalWindow });
  }
});
