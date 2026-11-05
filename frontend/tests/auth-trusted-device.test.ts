import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import assert from 'node:assert/strict';
import test from 'node:test';

import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

const user = {
  id: 'trusted-user', name: 'Trusted user', email: 'trusted@example.invalid',
  hasRecoveryCode: true, salary: 0, salaryReceiveDay: null, notes: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
function success(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return { config, data, status: 200, statusText: 'OK', headers: {} };
}

test('frontend trusted-device login is a two-request proof, not a password-only retry', async () => {
  const original = api.defaults.adapter;
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  try {
    useAuthStore.getState().setUser(null);
    const revision = useAuthStore.getState().sessionRevision;
    api.defaults.adapter = async (config) => {
      calls.push({ path: String(config.url), body: JSON.parse(String(config.data ?? '{}')) as Record<string, unknown> });
      if (config.url === '/auth/trusted-device/challenge') {
        return success(config, { challengeId: 'server-id', nonce: 'server-nonce' });
      }
      if (config.url === '/auth/trusted-device/login') return success(config, { user });
      throw Error(`Unexpected request ${config.url}`);
    };
    const loggedIn = await useAuthStore.getState().trustedDeviceLogin(user.email, 'Password123!');
    assert.equal(loggedIn.id, user.id);
    assert.ok(useAuthStore.getState().sessionRevision > revision);
    assert.deepEqual(calls.map((entry) => entry.path), [
      '/auth/trusted-device/challenge', '/auth/trusted-device/login',
    ]);
    const loginCall = calls[1];
    assert.ok(loginCall);
    assert.deepEqual(loginCall.body, {
      email: user.email, password: 'Password123!',
      challengeId: 'server-id', nonce: 'server-nonce',
    });
    assert.equal(Object.keys(loginCall.body).includes('deviceSecret'), false,
      'the HttpOnly browser possession token cannot be handled in JS');
    assert.equal(useAuthStore.getState().pendingRecoveryCode, null);
  } finally {
    api.defaults.adapter = original;
    useAuthStore.getState().setUser(null);
  }
});

test('trusted-device enrollment/revocation never puts the browser possession secret in state', async () => {
  const original = api.defaults.adapter;
  const actions: string[] = [];
  try {
    useAuthStore.getState().setUser(user);
    api.defaults.adapter = async (config) => {
      actions.push(String(config.url));
      if (config.url === '/auth/trusted-device') return success(config, {
        devices: [{ id: 'id', label: 'Notebook', createdAt: '2026-01-01',
          lastUsedAt: null, expiresAt: '2026-02-01' }],
      });
      return success(config, { ok: true, id: 'id' });
    };
    await useAuthStore.getState().enrollTrustedDevice('ValidPassword123!', 'Notebook');
    assert.equal((await useAuthStore.getState().listTrustedDevices()).length, 1);
    await useAuthStore.getState().revokeTrustedDevice('id', 'ValidPassword123!');
    assert.deepEqual(actions, [
      '/auth/trusted-device/enroll', '/auth/trusted-device', '/auth/trusted-device/revoke',
    ]);
    assert.equal(JSON.stringify(useAuthStore.getState()).includes('deviceSecret'), false);
  } finally {
    api.defaults.adapter = original;
    useAuthStore.getState().setUser(null);
  }
});
