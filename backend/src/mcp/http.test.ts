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
    const reply = JSON.parse(payload) as {
      result?: { tools?: Array<{ name: string; annotations?: {
        readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean;
      } }> };
    };
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
    const byName = new Map(reply.result?.tools?.map((tool) => [tool.name, tool]));
    for (const name of [
      'list_piggy_banks', 'list_income_tags',
      'preview_financial_operation', 'get_operation_status',
      'list_financial_operation_history', 'preview_undo_financial_operation',
    ]) {
      assert.deepEqual(byName.get(name)?.annotations, {
        readOnlyHint: true, destructiveHint: false, openWorldHint: false,
      }, `${name} is explicitly read-only and limited to this account`);
    }
    assert.deepEqual(byName.get('get_financial_overview')?.annotations, {
      readOnlyHint: true, destructiveHint: false, openWorldHint: true,
    }, 'patrimony reports may query external market sources');
    assert.deepEqual(byName.get('execute_financial_operation')?.annotations, {
      readOnlyHint: false, destructiveHint: true, openWorldHint: true,
    }, 'posting may refresh CDI from external market sources');
    assert.deepEqual(byName.get('undo_financial_operation')?.annotations, {
      readOnlyHint: false, destructiveHint: true, openWorldHint: false,
    }, 'undo is a sensitive local financial write');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('MCP enforces its own byte budget at the exact boundary, with and without Content-Length', async () => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@127.0.0.1:1/nonexistent';
  const { createMcpHttpRouter, MCP_REQUEST_BODY_MAX_BYTES } = await import('./http');
  const app = express();
  app.use(createMcpHttpRouter({
    resourceUrl: 'http://127.0.0.1/api/mcp',
    issuerUrl: 'http://127.0.0.1/api/oauth',
    isProduction: false,
    verifyBearer: async (token) => token === 'test-reader'
      ? { userId: 'only-this-user', clientId: 'read-client', scopes: new Set(['finance:read']) }
      : null,
  }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const baseHeaders = {
    Authorization: 'Bearer test-reader',
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  };
  const payload = (size: number) => {
    const minimum = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: { padding: '' } });
    assert.ok(size >= Buffer.byteLength(minimum));
    const body = JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list',
      params: { padding: 'x'.repeat(size - Buffer.byteLength(minimum)) } });
    assert.equal(Buffer.byteLength(body), size);
    return body;
  };

  try {
    const boundary = await fetch(url, {
      method: 'POST', headers: baseHeaders, body: payload(MCP_REQUEST_BODY_MAX_BYTES),
    });
    assert.equal(boundary.status, 200, 'exact byte budget must remain usable');
    const over = await fetch(url, {
      method: 'POST', headers: baseHeaders, body: payload(MCP_REQUEST_BODY_MAX_BYTES + 1),
    });
    assert.equal(over.status, 413, 'declared Content-Length above budget');

    const chunked = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(url, {
        method: 'POST', headers: { ...baseHeaders, 'Transfer-Encoding': 'chunked' },
      }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      });
      request.on('error', reject);
      const body = payload(MCP_REQUEST_BODY_MAX_BYTES + 1);
      request.write(body.slice(0, 100_000));
      request.end(body.slice(100_000));
    });
    assert.equal(chunked, 413, 'stream without Content-Length is bounded too');

    const unauthorized = await fetch(url, {
      method: 'POST', headers: { ...baseHeaders, Authorization: '' },
      body: payload(MCP_REQUEST_BODY_MAX_BYTES + 1),
    });
    assert.equal(unauthorized.status, 401, 'bearer guard precedes the MCP parser');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
