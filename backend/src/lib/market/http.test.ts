import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import { getJson, resetProviderCooldowns } from '@/lib/market/http';
import { MarketDataError } from '@/lib/market/types';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  resetProviderCooldowns();
});

function stub(responder: (url: string) => Response) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    calls.push(String(input));
    return responder(String(input));
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

test('getJson returns parsed JSON', async () => {
  stub(() => json({ ok: 1 }));
  assert.deepEqual(await getJson('https://a.example/x'), { ok: 1 });
});

test('429 puts the host in cooldown and later calls fail fast without fetching', async () => {
  const calls = stub(() => new Response('slow down', { status: 429 }));
  await assert.rejects(() => getJson('https://b.example/x'), /429/);
  await assert.rejects(
    () => getJson('https://b.example/y'),
    (error: unknown) =>
      error instanceof MarketDataError && error.message === 'Provider em cooldown',
  );
  assert.equal(calls.length, 1);
  // Another host is unaffected.
  stub(() => json([]));
  assert.deepEqual(await getJson('https://c.example/x'), []);
});

test('HTML responses are treated as a blocked network', async () => {
  stub(
    () =>
      new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
  );
  await assert.rejects(() => getJson('https://d.example/x'), /bloqueado/);
});

test('404 resolves to the provided empty value only when asked', async () => {
  stub(() => new Response('', { status: 404 }));
  assert.deepEqual(await getJson<unknown[]>('https://e.example/x', { onNotFound: [] }), []);
  await assert.rejects(() => getJson('https://e.example/y'), /404/);
});

test('oversized bodies are rejected by the size cap', async () => {
  stub(() => json({ big: 'x'.repeat(2000) }));
  await assert.rejects(
    () => getJson('https://f.example/x', { maxBytes: 100 }),
    /limite/,
  );
});
