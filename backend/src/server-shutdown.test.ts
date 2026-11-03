import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer, get } from 'node:http';
import { test } from 'node:test';

import { installGracefulShutdown } from './server-shutdown';

test('B14 SIGTERM stops accepting connections and drains an active request before disconnect', async () => {
  const signals = new EventEmitter();
  let answer: (() => void) | undefined;
  let entered!: () => void;
  const pending = new Promise<void>((resolve) => { entered = resolve; });
  const server = createServer((_req, res) => {
    answer = () => res.end('ok');
    entered();
  });
  let disconnectCount = 0;
  const stop = installGracefulShutdown(server, async () => { disconnectCount += 1; }, {
    signals,
    timeoutMs: 2000,
    forceExit: () => { throw new Error('Unexpected forced exit'); },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const response = new Promise<string>((resolve, reject) => {
    get(`http://127.0.0.1:${address.port}/slow`, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      res.on('error', reject);
    }).on('error', reject);
  });
  await pending;
  signals.emit('SIGTERM');
  assert.equal(disconnectCount, 0);
  await assert.rejects(new Promise<void>((resolve, reject) => {
    get(`http://127.0.0.1:${address.port}/late`, (res) => { res.resume(); resolve(); }).on('error', reject);
  }), /ECONNREFUSED|ECONNRESET|socket hang up/);
  assert(answer);
  answer();
  assert.equal(await response, 'ok');
  await stop();
  await stop();
  assert.equal(disconnectCount, 1);
  await assert.rejects(new Promise<void>((resolve, reject) => {
    get(`http://127.0.0.1:${address.port}/late`, (res) => { res.resume(); resolve(); }).on('error', reject);
  }), /ECONNREFUSED|ECONNRESET|socket hang up/);
});

test('B14 shutdown has a finite deadline for hanging HTTP requests', async () => {
  const signals = new EventEmitter();
  let entered!: () => void;
  const pending = new Promise<void>((resolve) => { entered = resolve; });
  const server = createServer((_req, _res) => entered());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const socket = get(`http://127.0.0.1:${address.port}/hang`);
  socket.on('error', () => {});
  await pending;
  let forced = 0;
  const stop = installGracefulShutdown(server, async () => {}, {
    signals,
    timeoutMs: 50,
    forceExit: () => { forced += 1; },
  });
  signals.emit('SIGINT');
  await stop();
  assert.equal(forced, 1);
});
