import { act, createElement } from 'react';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { Window } from 'happy-dom';
import assert from 'node:assert/strict';
import { createHook } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

test('A01 App and real router keep recovery code through session remount until explicit confirmation', async () => {
  // Some app-wide background timers outlive a mounted dashboard in a simulated
  // DOM. Track only timers created during this isolated client test so they can
  // be unrefed after unmount rather than keeping the Node test worker alive.
  const timers = new Set<{ unref: () => void }>();
  const hook = createHook({ init(_id, type, _trigger, resource) {
    const timer = resource as { unref?: () => void };
    if (type === 'Timeout' && typeof timer.unref === 'function') {
      timers.add(timer as { unref: () => void });
    }
  } });
  hook.enable();
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
    // The real App imports an image URL through a sidebar. Node's test runner
    // does not have Vite's asset loader; only that static image needs a stub.
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.endsWith('/favicon.svg')) {
          return { url: 'data:text/javascript,export default "/favicon.svg";', shortCircuit: true };
        }
        return nextResolve(specifier, context);
      },
    });
    const { App } = await import('@/App');
    const { createRoot } = await import('react-dom/client');
    // Happy DOM implements the browser DOM, but its TypeScript declarations are
    // distinct from lib.dom types expected by React and querySelector generics.
    const host = browser.document.createElement('div') as unknown as HTMLDivElement;
    browser.document.body.appendChild(host as unknown as InstanceType<typeof browser.HTMLElement>);
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
        input.dispatchEvent(new browser.Event('input', { bubbles: true }) as unknown as Event);
      });
    };
    await fill('register-name', 'Registered');
    await fill('register-email', 'registered@example.invalid');
    await fill('register-password', 'TestPassPhrase2026');
    await fill('register-confirm-password', 'TestPassPhrase2026');
    const previousRevision = useAuthStore.getState().sessionRevision;
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(
        new browser.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event,
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
    const { router } = await import('@/router');
    router.dispose();
    api.defaults.adapter = originalAdapter;
    useAuthStore.getState().setUser(null);
    browser.close();
    for (const key of globalKeys) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await browser.happyDOM.abort();
    hook.disable();
    for (const timer of timers) timer.unref();
  }
});
