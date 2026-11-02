import { act, createElement } from 'react';
import { Window } from 'happy-dom';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import assert from 'node:assert/strict';
import test from 'node:test';

import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

test('A01 App and real router keep recovery code through session remount until explicit confirmation', async () => {
  const browser = new Window({ url: 'http://localhost:5180/register' });
  const globalKeys = [
    'window', 'document', 'navigator', 'location', 'history',
    'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent',
    'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT',
  ] as const;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of globalKeys) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === 'IS_REACT_ACT_ENVIRONMENT' ? true :
      key === 'window' ? browser : (browser as unknown as Record<string, unknown>)[key];
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const originalAdapter = api.defaults.adapter;
  let root: import('react-dom/client').Root | undefined;
  try {
    useAuthStore.getState().setUser(null);
    const account = {
      id: 'registered', name: 'Registered', email: 'registered@example.invalid',
      hasRecoveryCode: true, salary: 0, salaryReceiveDay: null, notes: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    let registrations = 0;
    api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      const response = (data: unknown): AxiosResponse => ({
        data, config, status: 200, statusText: 'OK', headers: {},
      });
      if (config.url === '/auth/register') {
        registrations++;
        return response({ user: account, recoveryCode: 'BCDF-GHJK-LMNP-QRST' });
      }
      if (config.url === '/auth/me') {
        if (useAuthStore.getState().user) return response({ user: account });
        throw new AxiosError('Unauthenticated', 'ERR_BAD_RESPONSE', config, undefined, {
          ...response({ error: 'unauthorized' }), status: 401, statusText: 'Unauthorized',
        });
      }
      return response([]);
    };
    const { App } = await import('@/App');
    const { createRoot } = await import('react-dom/client');
    const host = browser.document.createElement('div');
    browser.document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(App));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.ok(host.querySelector('form'), 'real RegisterPage form mounted');
    const fill = async (id: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(`#${id}`);
      assert.ok(input, `missing ${id}`);
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')?.set;
        assert.ok(setter);
        setter.call(input, value);
        input.dispatchEvent(new browser.Event('input', { bubbles: true }));
      });
    };
    await fill('register-name', 'Registered');
    await fill('register-email', 'registered@example.invalid');
    await fill('register-password', 'TestPassPhrase2026');
    await fill('register-confirm-password', 'TestPassPhrase2026');
    const previousRevision = useAuthStore.getState().sessionRevision;
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(
        new browser.Event('submit', { bubbles: true, cancelable: true }),
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.equal(registrations, 1);
    assert.ok(useAuthStore.getState().sessionRevision > previousRevision);
    assert.equal(useAuthStore.getState().pendingRecoveryCode, 'BCDF-GHJK-LMNP-QRST');
    assert.match(host.textContent ?? '', /BCDF-GHJK-LMNP-QRST/);
    const button = [...host.querySelectorAll('button')].find(
      (item) => item.textContent?.includes('Já guardei, continuar'),
    );
    assert.ok(button, 'remounted RegisterPage must offer acknowledgement');
    await act(async () => { await useAuthStore.getState().fetchMe(); });
    assert.match(host.textContent ?? '', /BCDF-GHJK-LMNP-QRST/);
    await act(async () => {
      button.click();
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.equal(useAuthStore.getState().pendingRecoveryCode, null);
    assert.equal(browser.location.pathname, '/');
    assert.doesNotMatch(host.textContent ?? '', /BCDF-GHJK-LMNP-QRST/);
  } finally {
    if (root) await act(async () => { root!.unmount(); });
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
    for (const key of globalKeys) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await browser.happyDOM.abort();
  }
});
