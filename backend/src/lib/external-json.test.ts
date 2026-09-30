import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExternalJsonTooLargeError,
  readBoundedJson,
} from '@/lib/external-json';

test('reads valid JSON within the byte limit', async () => {
  const result = await readBoundedJson<{ ok: boolean }>(
    new Response('{"ok":true}'),
    16,
  );
  assert.deepEqual(result, { ok: true });
});

test('rejects an oversized response from Content-Length before parsing', async () => {
  const response = new Response('{"ok":true}', {
    headers: { 'content-length': '1024' },
  });
  await assert.rejects(
    readBoundedJson(response, 16),
    ExternalJsonTooLargeError,
  );
});

test('rejects an oversized streamed response when Content-Length is absent', async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"123456789"}'));
        controller.close();
      },
    }),
  );
  await assert.rejects(
    readBoundedJson(response, 8),
    ExternalJsonTooLargeError,
  );
});
