import { isIP } from 'node:net';
import Provider, { type ClientMetadata, type Configuration,errors } from 'oidc-provider';

import { prisma } from '@/lib/prisma';
import { APP_URL } from '@/utils/var';

import { OAuthPrismaAdapter } from './adapter';

const FINANCE_SCOPES = ['finance:read', 'finance:write'] as const;
export type FinanceScope = (typeof FINANCE_SCOPES)[number];

type OAuthOptions = {
  issuer?: string;
  resource?: string;
  jwks?: Configuration['jwks'];
  cookieKeys?: string[];
  clients?: ClientMetadata[];
  clientHosts?: string[];
};

export function oauthSettings() {
  const base = APP_URL?.replace(/\/+$/, '');
  return {
    issuer: process.env.MCP_ISSUER_URL ?? (base ? `${base}/api/oauth` : ''),
    resource: process.env.MCP_RESOURCE_URL ?? (base ? `${base}/api/mcp` : ''),
  };
}

function requirePublicUrl(value: string, name: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`[deManage] ${name} must be an absolute URL`);
  }
  if (url.username || url.password || url.hash || url.search || !['https:', 'http:'].includes(url.protocol)) {
    throw new Error(`[deManage] Invalid ${name}`);
  }
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error(`[deManage] ${name} must use HTTPS`);
  }
  return url.toString().replace(/\/$/, '');
}

export function createOAuthProvider(options: OAuthOptions = {}) {
  const settings = oauthSettings();
  const issuer = requirePublicUrl(options.issuer ?? settings.issuer, 'MCP_ISSUER_URL');
  const resource = requirePublicUrl(options.resource ?? settings.resource, 'MCP_RESOURCE_URL');
  const keys = options.cookieKeys ?? process.env.MCP_OAUTH_COOKIE_KEYS?.split(',').map((key) => key.trim());
  if (!keys?.length || keys.some((key) => Buffer.byteLength(key, 'utf8') < 32)) {
    throw new Error('[deManage] MCP_OAUTH_COOKIE_KEYS requires 32+ byte secret(s)');
  }
  let jwks = options.jwks;
  if (!jwks) {
    try {
      jwks = JSON.parse(process.env.MCP_OAUTH_JWKS ?? '') as Configuration['jwks'];
    } catch {
      throw new Error('[deManage] MCP_OAUTH_JWKS must be a private signing key set');
    }
  }
  const clientHosts = new Set((options.clientHosts ?? process.env.MCP_OAUTH_CLIENT_HOSTS?.split(',') ?? [])
    .map((host) => host.toLowerCase().trim()).filter(Boolean));

  const configuration: Configuration = {
    adapter: (model) => new OAuthPrismaAdapter(model),
    jwks,
    clients: options.clients ?? [],
    responseTypes: ['code'],
    scopes: ['openid', 'offline_access', ...FINANCE_SCOPES],
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      clientIdMetadataDocument: {
        enabled: true,
        ack: 'draft-02',
        allowFetch(_ctx, id) {
          try {
            const url = new URL(id);
            return url.protocol === 'https:' && !url.username && !url.password &&
              !url.hash && !isIP(url.hostname) && url.port === '' &&
              clientHosts.has(url.hostname.toLowerCase());
          } catch {
            return false;
          }
        },
        allowClient(_ctx, client) {
          return client.tokenEndpointAuthMethod === 'none' &&
            Array.isArray(client.grantTypes) && client.grantTypes.every((type) => type === 'authorization_code' || type === 'refresh_token') &&
            Array.isArray(client.responseTypes) && client.responseTypes.every((type) => type === 'code') &&
            Array.isArray(client.redirectUris) && client.redirectUris.length > 0 &&
            client.redirectUris.every((redirect) => {
              try {
                const url = new URL(redirect);
                return !url.username && !url.password && !url.hash &&
                  (url.protocol === 'https:' ||
                    (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
              } catch {
                return false;
              }
            });
        },
        cacheDuration: { min: 30, max: 300 },
      },
      resourceIndicators: {
        enabled: true,
        getResourceServerInfo(_ctx, requested) {
          if (requested !== resource) throw new errors.InvalidTarget('Unknown protected resource');
          return { audience: resource, scope: FINANCE_SCOPES.join(' '), accessTokenTTL: 900, accessTokenFormat: 'opaque' };
        },
        defaultResource() { return resource; },
        useGrantedResource() { return true; },
      },
      revocation: { enabled: true },
    },
    cookies: {
      keys,
      long: { secure: issuer.startsWith('https:'), sameSite: 'lax' },
      short: { secure: issuer.startsWith('https:'), sameSite: 'lax' },
    },
    ttl: { AccessToken: 900, AuthorizationCode: 120, Interaction: 300, Session: 3600, Grant: 7 * 86400, RefreshToken: 7 * 86400 },
    issueRefreshToken(_ctx, client) {
      return client.grantTypeAllowed('refresh_token');
    },
    interactions: {
      url(_ctx, interaction) {
        const base = new URL(issuer);
        const appOrigin = `${base.protocol}//${base.host}`;
        return `${appOrigin}/oauth/consent?uid=${encodeURIComponent(interaction.uid)}`;
      },
    },
    async findAccount(_ctx, subject) {
      const user = await prisma.user.findUnique({ where: { id: subject }, select: { id: true } });
      return user ? { accountId: user.id, claims: () => ({ sub: user.id }) } : undefined;
    },
    acceptQueryParamAccessTokens: false,
    allowOmittingSingleRegisteredRedirectUri: false,
  };
  const provider = new Provider(issuer, configuration);
  provider.proxy = true;
  return provider;
}

let singleton: Provider | undefined;
export function getOAuthProvider() {
  singleton ??= createOAuthProvider();
  return singleton;
}

export type OAuthGrantSubject = {
  userId: string;
  clientId: string;
  scopes: Set<FinanceScope>;
};

/** Verify opaque bearer credentials against the provider's DB and live user consent. */
export async function getOAuthGrantSubject(
  accessToken: string,
  expectedResource: string,
  provider = getOAuthProvider(),
): Promise<OAuthGrantSubject | null> {
  if (!accessToken || accessToken.length > 4096 || expectedResource !== oauthSettings().resource && provider === singleton) {
    return null;
  }
  const token = await provider.AccessToken.find(accessToken);
  if (!token || token.isExpired || !token.accountId || !token.clientId || !token.grantId) return null;
  if (token.aud !== expectedResource && !(Array.isArray(token.aud) && token.aud.length === 1 && token.aud[0] === expectedResource)) return null;
  const scopes = new Set(token.scope?.split(' ').filter((scope): scope is FinanceScope =>
    FINANCE_SCOPES.some((allowed) => allowed === scope)) ?? []);
  if (!scopes.size) return null;
  const connection = await prisma.oAuthConnection.findUnique({
    where: { grantId: token.grantId },
    select: { userId: true, clientId: true, scopes: true, revokedAt: true },
  });
  if (!connection || connection.revokedAt || connection.userId !== token.accountId || connection.clientId !== token.clientId) return null;
  if (![...scopes].every((scope) => connection.scopes.split(' ').includes(scope))) return null;
  const [grant, user] = await Promise.all([
    provider.Grant.find(token.grantId),
    prisma.user.findUnique({ where: { id: token.accountId }, select: { id: true } }),
  ]);
  return grant && user ? { userId: user.id, clientId: token.clientId, scopes } : null;
}

export async function revokeClientGrant(userId: string, clientId: string) {
  const connection = await prisma.oAuthConnection.findUnique({ where: { userId_clientId: { userId, clientId } } });
  if (!connection || connection.revokedAt) return false;
  await prisma.$transaction([
    prisma.oAuthConnection.update({ where: { id: connection.id }, data: { revokedAt: new Date() } }),
    prisma.oAuthArtifact.deleteMany({ where: { OR: [{ grantId: connection.grantId }, { model: 'Grant', id: connection.grantId }] } }),
  ]);
  return true;
}
