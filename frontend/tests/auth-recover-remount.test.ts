import { act, createElement } from 'react';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { Window } from 'happy-dom';
import assert from 'node:assert/strict';
import { createHook } from 'node:async_hooks';
import { registerHooks } from 'node:module';
import test from 'node:test';

import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

test('full App preserves rotated recovery code through authenticated session remount and stale /auth/me', async () => {
  const timers = new Set<{ unref: () => void }>();
  const hook = createHook({ init(_id, type, _trigger, resource) {
    const timer = resource as { unref?: () => void };
    if (type === 'Timeout' && typeof timer.unref === 'function') timers.add(timer as { unref: () => void });
  } });
  hook.enable();
  const browser = new Window({ url: 'http://localhost:5180/recuperar-senha' });
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
  const nextCode = 'BCDFG-HJKLM-NPQRS-TUVWX';
  const user = {
    id: 'recovered', name: 'Recovered', email: 'recovered@example.invalid',
    hasRecoveryCode: true, salary: 0, salaryReceiveDay: null, notes: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  let recoveries = 0;
  let holdNextMe = false;
  let staleMe: ((response: AxiosResponse) => void) | undefined;
  try {
    useAuthStore.getState().setUser(null);
    api.defaults.adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      const response = (data: unknown): AxiosResponse => ({
        data, config, status: 200, statusText: 'OK', headers: {},
      });
      if (config.url === '/auth/recover-password') {
        recoveries++;
        return response({ user, recoveryCode: nextCode });
      }
      if (config.url === '/auth/me') {
        if (holdNextMe) {
          holdNextMe = false;
          return new Promise<AxiosResponse>((resolve) => { staleMe = resolve; });
        }
        if (useAuthStore.getState().user) return response({ user });
        throw new AxiosError('Unauthenticated', 'ERR_BAD_RESPONSE', config, undefined, {
          ...response({ error: 'unauthorized' }), status: 401, statusText: 'Unauthorized',
        });
      }
      return response([]);
    };

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
    const host = browser.document.createElement('div') as unknown as HTMLDivElement;
    browser.document.body.appendChild(host as unknown as InstanceType<typeof browser.HTMLElement>);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(App));
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.ok(host.querySelector('form'), 'real RecoverPasswordPage form should mount');

    const fill = async (id: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(`#${id}`);
      assert.ok(input, `missing input ${id}`);
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')?.set;
        assert.ok(setter);
        setter.call(input, value);
        input.dispatchEvent(new browser.Event('input', { bubbles: true }) as unknown as Event);
      });
    };
    await fill('recovery-email', user.email);
    await fill('recovery-code', 'BCDF-GHJK-LMNP-QRST');
    await fill('recovery-password', 'NewPassword2026!');
    await fill('recovery-confirm-password', 'NewPassword2026!');

    holdNextMe = true;
    const previousMe = useAuthStore.getState().fetchMe();
    for (let i = 0; i < 20 && !staleMe; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    assert.ok(staleMe, 'stale /auth/me must be in flight before recovery');
    const initialRevision = useAuthStore.getState().sessionRevision;
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(
        new browser.Event('submit', { bubbles: true, cancelable: true }) as unknown as Event,
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.equal(recoveries, 1);
    assert.equal(useAuthStore.getState().isAuthenticated, true);
    assert.ok(useAuthStore.getState().sessionRevision > initialRevision);
    assert.equal(useAuthStore.getState().pendingRecoveryCode, nextCode,
      'code must survive the keyed App remount in volatile store');
    assert.equal(browser.location.pathname, '/recuperar-senha', 'must remain on recovery until acknowledged');
    assert.match(host.textContent ?? '', new RegExp(nextCode), 'new offline recovery code must remain visible');
    assert.ok(!browser.localStorage.getItem('demanage:recoveryCode'));
    assert.ok(!JSON.stringify(browser.localStorage).includes(nextCode), 'never persist offline secret');

    await act(async () => {
      staleMe!({
        config: { url: '/auth/me', headers: {} } as InternalAxiosRequestConfig,
        data: { user: { ...user, id: 'previous-account' } },
        status: 200, statusText: 'OK', headers: {},
      });
      await previousMe;
    });
    assert.equal(useAuthStore.getState().user?.id, user.id, 'old /auth/me cannot replace recovered identity');
    assert.equal(useAuthStore.getState().pendingRecoveryCode, nextCode);

    const confirm = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Já guardei, continuar'));
    assert.ok(confirm, 'must offer explicit acknowledgement before navigating');
    await act(async () => { await useAuthStore.getState().fetchMe(); });
    assert.equal(useAuthStore.getState().pendingRecoveryCode, nextCode);
    assert.match(host.textContent ?? '', new RegExp(nextCode));
    await act(async () => {
      confirm.click();
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
    assert.equal(useAuthStore.getState().pendingRecoveryCode, null);
    assert.equal(browser.location.pathname, '/');
    assert.doesNotMatch(host.textContent ?? '', new RegExp(nextCode));
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
