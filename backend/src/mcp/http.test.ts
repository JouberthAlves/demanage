import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';

test('protected MCP discovery, request origin, user auth and read-only tools/list', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:1/nonexistent';
  const { createMcpHttpRouter } = await import('./http');
  const app = express();
  app.use(createMcpHttpRouter({
    resourceUrl: 'http://127.0.0.1/api/mcp',
    issuerUrl: 'http://127.0.0.1/api/oauth',
    isProduction: false,
    verifyBearer: async (token, expectedResource) => {
      assert.equal(expectedResource, 'http://127.0.0.1/api/mcp');
      return token === 'test-reader'
        ? { userId: 'only-this-user', clientId: 'read-client', scopes: new Set(['finance:read']) }
        : null;
    },
  }));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const rpc = JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
  const headers = {
    Authorization: 'Bearer test-reader',
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  };

  try {
    const metadata = await fetch(`${url}/.well-known/oauth-protected-resource`);
    assert.equal(metadata.status, 200);
    const json = await metadata.json() as { resource: string; authorization_servers: string[] };
    assert.equal(json.resource, 'http://127.0.0.1/api/mcp');
    assert.deepEqual(json.authorization_servers, ['http://127.0.0.1/api/oauth']);

    const cookieOnly = await fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { Cookie: 'demanage-token=browser-token', ...headers, Authorization: '' },
      body: rpc,
    });
    assert.equal(cookieOnly.status, 401);
    assert.match(cookieOnly.headers.get('www-authenticate') ?? '', /resource_metadata/);

    const untrustedOrigin = await fetch(`${url}/mcp`, {
      method: 'POST', headers: { ...headers, Origin: 'https://evil.example.invalid' }, body: rpc,
    });
    assert.equal(untrustedOrigin.status, 403);

    const untrustedHostStatus = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${url}/mcp`, {
        method: 'POST',
        headers: { ...headers, Host: 'evil.example.invalid' },
      }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      });
      request.on('error', reject);
      request.end(rpc);
    });
    assert.equal(untrustedHostStatus, 403);

    const allowed = await fetch(`${url}/mcp`, { method: 'POST', headers, body: rpc });
    assert.equal(allowed.status, 200);
    const body = await allowed.text();
    const payload = body.startsWith('event:')
      ? body.split(/\r?\n/).find((line) => line.startsWith('data: '))?.slice(6)
      : body;
    assert.ok(payload);
    const reply = JSON.parse(payload) as { result?: { tools?: Array<{ name: string }> } };
    assert.deepEqual(reply.result?.tools?.map(({ name }) => name).sort(), [
      'execute_financial_operation',
      'get_financial_overview',
      'get_operation_status',
      'list_financial_operation_history',
      'list_income_tags',
      'list_piggy_banks',
      'preview_financial_operation',
      'preview_undo_financial_operation',
      'undo_financial_operation',
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
