import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';

import { createMcpBearerGuard } from './auth';

const RESOURCE = 'https://mcp.example.invalid/mcp';
const METADATA = 'https://mcp.example.invalid/.well-known/oauth-protected-resource';

test('MCP requires bearer identity, ignores browser cookie and separates OAuth scopes', async () => {
  const calls: Array<{ token: string; resource: string }> = [];
  const verify = async (token: string, resource: string) => {
    calls.push({ token, resource });
    if (token === 'reader') return { userId: 'u1', clientId: 'c1', scopes: new Set(['finance:read']) };
    if (token === 'writer') return { userId: 'u2', clientId: 'c2', scopes: new Set(['finance:write']) };
    return null;
  };

  const app = express();
  app.get('/read', createMcpBearerGuard(verify, 'finance:read', RESOURCE, METADATA), (_req, res) => {
    res.json({ userId: res.locals.mcpIdentity?.userId });
  });
  app.post('/write', createMcpBearerGuard(verify, 'finance:write', RESOURCE, METADATA), (_req, res) => {
    res.json({ userId: res.locals.mcpIdentity?.userId });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const cookieOnly = await fetch(`${url}/read`, { headers: { Cookie: 'demanage-token=browserjwt' } });
    assert.equal(cookieOnly.status, 401);
    assert.match(cookieOnly.headers.get('www-authenticate') ?? '', /resource_metadata/);
    const malformed = await fetch(`${url}/read`, { headers: { Authorization: 'Basic abc' } });
    assert.equal(malformed.status, 401);
    const reader = await fetch(`${url}/read`, { headers: { Authorization: 'Bearer reader' } });
    assert.equal(reader.status, 200);
    assert.deepEqual(await reader.json(), { userId: 'u1' });
    const forbidden = await fetch(`${url}/write`, { method: 'POST', headers: { Authorization: 'Bearer reader' } });
    assert.equal(forbidden.status, 403);
    assert.match(forbidden.headers.get('www-authenticate') ?? '', /insufficient_scope/);
    const writer = await fetch(`${url}/write`, { method: 'POST', headers: { Authorization: 'Bearer writer' } });
    assert.equal(writer.status, 200);
    assert.deepEqual(await writer.json(), { userId: 'u2' });
    assert.deepEqual(calls, [
      { token: 'reader', resource: RESOURCE },
      { token: 'reader', resource: RESOURCE },
      { token: 'writer', resource: RESOURCE },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
