import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type McpScope = 'finance:read' | 'finance:write';

export type McpIdentity = {
  userId: string;
  clientId: string;
  scopes: ReadonlySet<string>;
  /** OAuth provider grant checked when the bearer was received. */
  oauthGrantId?: string;
};

export type McpTokenVerifier = (
  token: string,
  resource: string,
) => Promise<McpIdentity | null>;

declare module 'express-serve-static-core' {
  interface Locals {
    mcpIdentity?: McpIdentity;
  }
}

function challenge(res: Response, metadataUrl: string, error?: string, scope?: string) {
  const parameters = [`resource_metadata="${metadataUrl}"`];
  if (error) parameters.push(`error="${error}"`);
  if (scope) parameters.push(`scope="${scope}"`);
  res.setHeader('WWW-Authenticate', `Bearer ${parameters.join(', ')}`);
}

/** MCP uses independent, audience-bound OAuth bearer credentials, never browser cookies. */
export function createMcpBearerGuard(
  verify: McpTokenVerifier,
  scope: McpScope | undefined,
  resource: string,
  metadataUrl: string,
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(req.headers.authorization ?? '');
    if (!match || match[1].length > 4096) {
      challenge(res, metadataUrl);
      res.status(401).json({ error: 'Autenticação MCP necessária' });
      return;
    }

    try {
      const identity = await verify(match[1], resource);
      if (!identity || !identity.userId || !identity.clientId) {
        challenge(res, metadataUrl, 'invalid_token');
        res.status(401).json({ error: 'Token MCP inválido' });
        return;
      }
      if (scope && !identity.scopes.has(scope)) {
        challenge(res, metadataUrl, 'insufficient_scope', scope);
        res.status(403).json({ error: 'Permissão MCP insuficiente' });
        return;
      }
      res.locals.mcpIdentity = identity;
      next();
    } catch {
      challenge(res, metadataUrl, 'invalid_token');
      res.status(401).json({ error: 'Token MCP inválido' });
    }
  };
}
