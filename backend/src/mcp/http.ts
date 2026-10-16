import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { Request, Response } from 'express';
import { Router } from 'express';

import { isAllowedBrowserOrigin } from '@/lib/request-origin';

import { createMcpBearerGuard, type McpTokenVerifier } from './auth';
import { registerFinanceTools } from './tools';

export type McpHttpOptions = {
  verifyBearer: McpTokenVerifier;
  resourceUrl: string;
  issuerUrl: string;
  /** Explicit external URL for RFC9728 discovery, normally on the app origin. */
  metadataUrl?: string;
  isProduction?: boolean;
};

function hostMatches(req: Request, resourceUrl: string, isProduction: boolean) {
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  let expected: string;
  let actual: string;
  try {
    expected = new URL(resourceUrl).hostname.toLowerCase();
    actual = new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  return actual === expected || (!isProduction && ['localhost', '127.0.0.1', '[::1]'].includes(actual));
}

/** HTTPS reverse proxy handles /api/mcp -> /mcp. No browser session is accepted. */
export function createMcpHttpRouter({
  verifyBearer,
  resourceUrl,
  issuerUrl,
  metadataUrl = new URL('/.well-known/oauth-protected-resource', resourceUrl).toString(),
  isProduction = process.env.NODE_ENV === 'production',
}: McpHttpOptions) {
  const resource = new URL(resourceUrl);
  const issuer = new URL(issuerUrl);
  if (isProduction && (resource.protocol !== 'https:' || issuer.protocol !== 'https:')) {
    throw new Error('MCP exige URL HTTPS pública em produção');
  }

  const router = Router();
  const handler = createMcpHandler(({ authInfo }) => {
    const userId = authInfo?.extra?.userId;
    const clientId = authInfo?.clientId;
    const scopes = authInfo?.scopes;
    if (typeof userId !== 'string' || typeof clientId !== 'string' || !Array.isArray(scopes)) {
      throw new Error('Identidade MCP não validada');
    }
    const server = new McpServer({ name: 'deManage Finance', version: '1.0.0' });
    registerFinanceTools(server, { userId, clientId, scopes: new Set(scopes) });
    return server;
  }, { responseMode: 'json' });
  const nodeHandler = toNodeHandler(handler);

  router.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
      resource: resourceUrl,
      authorization_servers: [issuerUrl],
      bearer_methods_supported: ['header'],
      scopes_supported: ['finance:read', 'finance:write'],
    });
  });

  router.all('/mcp', (req: Request, res: Response, next) => {
    if (!hostMatches(req, resourceUrl, isProduction)) {
      res.status(403).json({ error: 'Host MCP não autorizado' });
      return;
    }
    const origin = req.get('origin');
    if (origin && !isAllowedBrowserOrigin(origin)) {
      res.status(403).json({ error: 'Origin MCP não autorizado' });
      return;
    }
    next();
  }, createMcpBearerGuard(verifyBearer, undefined, resourceUrl, metadataUrl), (req, res, next) => {
    const identity = res.locals.mcpIdentity;
    if (!identity) {
      res.status(401).json({ error: 'Identidade MCP não validada' });
      return;
    }
    // toNodeHandler forwards req.auth into the per-request MCP factory.
    Object.assign(req, {
      auth: {
        token: (req.headers.authorization ?? '').slice(7),
        clientId: identity.clientId,
        scopes: [...identity.scopes],
        extra: { userId: identity.userId },
      },
    });
    Promise.resolve(nodeHandler(req, res)).catch(next);
  });
  return router;
}
