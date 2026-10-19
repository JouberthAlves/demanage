import { isIP } from 'node:net';
import Provider, { type Client, type ClientMetadata, type Configuration, errors } from 'oidc-provider';

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
  // Test-only injection; production uses oidc-provider's protected fetch.
  fetch?: Configuration['fetch'];
};

/** Only exact, explicitly trusted client-metadata hostnames; no wildcard. */
export function isAllowedCimdClientId(clientId: string, allowedHosts: ReadonlySet<string>) {
  try {
    const url = new URL(clientId);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.hash && !isIP(url.hostname) && url.port === '' &&
      allowedHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function allowedCimdHosts(configuredHosts = process.env.MCP_OAUTH_CLIENT_HOSTS?.split(',') ?? []) {
  // ChatGPT's stable CIMD is always available; all additional hostnames are opt-in.
  return new Set(['chatgpt.com', ...configuredHosts]
    .map((host) => host.toLowerCase().trim()).filter(Boolean));
}

const CHATGPT_CIMD = 'https://chatgpt.com/oauth/client.json';
const CHATGPT_JWKS = 'https://chatgpt.com/oauth/jwks.json';
const DAY_SECONDS = 86_400;

function isSignedChatGptClient(client: Client) {
  return client.clientId === CHATGPT_CIMD && client.clientAuthMethod === 'private_key_jwt';
}

/** A CIMD URL is the identity. Never accept public keys from a different host. */
export function isAllowedCimdClient(client: Client, hosts: ReadonlySet<string>) {
  const clientId = client.clientId;
  if (!isAllowedCimdClientId(clientId, hosts) || !Array.isArray(client.grantTypes) ||
      !client.grantTypes.length ||
      !client.grantTypes.every((type) => type === 'authorization_code' || type === 'refresh_token') ||
      !Array.isArray(client.responseTypes) || !client.responseTypes.length ||
      !client.responseTypes.every((type) => type === 'code') ||
      !Array.isArray(client.redirectUris) || !client.redirectUris.length) return false;

  const clientOrigin = new URL(clientId).origin;
  if (!client.redirectUris.every((value) => {
    try {
      const uri = new URL(value);
      return uri.username === '' && uri.password === '' && uri.hash === '' &&
        (uri.protocol === 'https:' ||
          (uri.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname))) &&
        (clientId !== CHATGPT_CIMD || uri.origin === clientOrigin);
    } catch {
      return false;
    }
  })) return false;

  if (client.tokenEndpointAuthMethod === 'none') return true;
  if (client.tokenEndpointAuthMethod !== 'private_key_jwt' ||
      client.tokenEndpointAuthSigningAlg !== 'RS256' || !client.jwksUri) return false;

  // Restrict signed ChatGPT assertions to OpenAI's published JWKS endpoint.
  if (clientOrigin === 'https://chatgpt.com') {
    return clientId === CHATGPT_CIMD && client.jwksUri === CHATGPT_JWKS && !client.jwks;
  }
  try {
    const jwks = new URL(client.jwksUri);
    return jwks.protocol === 'https:' && jwks.origin === clientOrigin &&
      jwks.username === '' && jwks.password === '' && jwks.hash === '' && jwks.search === '' &&
      jwks.port === '' && !client.jwks;
  } catch {
    return false;
  }
}

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

/** Log only fixed OAuth client-auth categories, never assertions, claims, or keys. */
export function classifyOAuthGrantFailure(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const { statusCode, error_detail: detail } = error as { statusCode?: unknown; error_detail?: unknown };
  if (statusCode !== 401) return null;
  if (typeof detail !== 'string') return 'other_client_auth_failure';
  if (detail.includes('authentication mechanism does not match')) return 'auth_method_mismatch';
  if (detail.includes('audience (aud)')) return 'assertion_audience_mismatch';
  if (detail.includes('alg mismatch')) return 'assertion_algorithm_mismatch';
  if (detail.includes('client not found')) return 'client_not_found';
  if (detail.includes('client assertion tokens must only be used once')) return 'assertion_replay';
  if (detail.includes('signature') || detail.includes('key verification')) return 'assertion_signature_failure';
  return 'other_client_auth_failure';
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
  const clientHosts = allowedCimdHosts(options.clientHosts);

  const configuration: Configuration = {
    adapter: (model) => new OAuthPrismaAdapter(model),
    jwks,
    clients: options.clients ?? [],
    clientAuthMethods: ['none', 'private_key_jwt'],
    enabledJWA: { clientAuthSigningAlgValues: ['RS256'] },
    // Keep oidc-provider's SSRF-protected dispatcher (passed via init), and
    // reject all redirects so an approved JWKS URL cannot forward to another host.
    fetch: options.fetch ?? ((input, init) => fetch(input, { ...init, redirect: 'manual' })),
    responseTypes: ['code'],
    scopes: ['openid', 'offline_access', ...FINANCE_SCOPES],
    pkce: { required: () => true },
    features: {
      devInteractions: { enabled: false },
      clientIdMetadataDocument: {
        enabled: true,
        ack: 'draft-02',
        allowFetch(_ctx, id) {
          return isAllowedCimdClientId(id, clientHosts);
        },
        allowClient(_ctx, client) { return isAllowedCimdClient(client, clientHosts); },
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
    ttl: {
      AccessToken: 900,
      AuthorizationCode: 120,
      Interaction: 300,
      Session: 3600,
      Grant(_ctx, grant) {
        return grant.clientId === CHATGPT_CIMD ? 90 * DAY_SECONDS : 7 * DAY_SECONDS;
      },
      RefreshToken(_ctx, _token, client) {
        return isSignedChatGptClient(client) ? 30 * DAY_SECONDS : 7 * DAY_SECONDS;
      },
    },
    expiresWithSession(ctx, source) {
      // ChatGPT uses authenticated refresh tokens without requesting offline_access.
      return !source.scopes.has('offline_access') &&
        !(ctx.oidc.client && isSignedChatGptClient(ctx.oidc.client));
    },
    issueRefreshToken(_ctx, client) {
      return client.grantTypeAllowed('refresh_token');
    },
    rotateRefreshToken(ctx) {
      const token = ctx.oidc.entities.RefreshToken;
      const client = ctx.oidc.entities.Client;
      if (!token || !client) return false;
      if (token.totalLifetime() >= 365.25 * DAY_SECONDS) return false;
      if (isSignedChatGptClient(client)) return true;
      if (client.clientAuthMethod === 'none' && !token.isSenderConstrained()) return true;
      return token.ttlPercentagePassed() >= 70;
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
  provider.on('grant.error', (ctx: unknown, error: unknown) => {
    const reason = classifyOAuthGrantFailure(error);
    if (!reason) return;
    const params = (ctx as { oidc?: { params?: { client_assertion?: unknown } } }).oidc?.params;
    console.warn(`[deManage] oauth-client-auth-rejected reason=${reason} signed_assertion=${typeof params?.client_assertion === 'string'}`);
  });
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
