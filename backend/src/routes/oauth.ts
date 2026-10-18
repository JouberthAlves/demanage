import { createHmac, timingSafeEqual } from 'node:crypto';
import { type Request,Router, urlencoded } from 'express';
import type Provider from 'oidc-provider';

import { requireUserId } from '@/http/request';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/middlewares/require-auth';
import {
  getOAuthProvider,
  oauthSettings,
  revokeClientGrant,
} from '@/oauth/provider';
import { APP_URL, JWT_SECRET } from '@/utils/var';

const ALLOWED_SCOPES = new Set(['finance:read', 'finance:write']);

function consentToken(uid: string, userId: string) {
  // The JWT secret is a separate key from the provider's persisted cookie keys.
  return createHmac('sha256', JWT_SECRET).update(`${uid}\0${userId}`).digest('hex');
}

function validConsentToken(token: unknown, uid: string, userId: string) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(consentToken(uid, userId), 'hex'));
}

function isOwnAppOrigin(req: Request) {
  const origin = req.get('origin');
  const expected = APP_URL && new URL(APP_URL).origin;
  return Boolean(origin && expected && origin === expected);
}

function requestedScopes(scope: unknown) {
  const requested = typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [];
  return requested.length > 0 && requested.every((value) =>
    ALLOWED_SCOPES.has(value) || value === 'openid' || value === 'offline_access')
    ? requested
    : null;
}

async function interactionForUser(provider: Provider, req: Request, res: Parameters<Provider['interactionDetails']>[1]) {
  const details = await provider.interactionDetails(req, res);
  if (req.params.uid !== details.uid) return null;
  if (details.session?.accountId && details.session.accountId !== requireUserId(req)) return null;
  if (!details.params?.client_id || typeof details.params.client_id !== 'string') return null;
  if (details.params.resource !== oauthSettings().resource) return null;
  const scopes = requestedScopes(details.params.scope);
  if (!scopes) return null;
  return { details, scopes, clientId: details.params.client_id };
}

export function createOAuthRouter(provider = getOAuthProvider()) {
  const router = Router();
  router.get('/connections', requireAuth, async (req, res) => {
    const connections = await prisma.oAuthConnection.findMany({
      where: { userId: requireUserId(req), revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { clientId: true, clientName: true, scopes: true, createdAt: true },
    });
    res.json({ connections: connections.map((connection) => ({
      ...connection,
      scopes: connection.scopes.split(' '),
    })) });
  });

  router.post('/connections/revoke', requireAuth, async (req, res) => {
    if (!isOwnAppOrigin(req) || typeof req.body?.clientId !== 'string') {
      res.status(403).json({ error: 'Requisição inválida' });
      return;
    }
    const revoked = await revokeClientGrant(requireUserId(req), req.body.clientId);
    res.json({ revoked });
  });

  router.get('/interaction/:uid', requireAuth, async (req, res) => {
    try {
      const interaction = await interactionForUser(provider, req, res);
      if (!interaction) {
        res.status(400).json({ error: 'Solicitação OAuth inválida' });
        return;
      }
      const client = await provider.Client.find(interaction.clientId);
      const prompt = interaction.details.prompt.name;
      if (prompt !== 'login' && prompt !== 'consent') {
        res.status(400).json({ error: 'Etapa de autoriza\u00e7\u00e3o inv\u00e1lida' });
        return;
      }
      res.json({
        uid: interaction.details.uid,
        step: prompt === 'login' ? 'account' : 'permissions',
        clientId: interaction.clientId,
        clientName: client?.clientName || interaction.clientId,
        scopes: interaction.scopes.filter((scope) => ALLOWED_SCOPES.has(scope)),
        resource: oauthSettings().resource,
        csrf: consentToken(interaction.details.uid, requireUserId(req)),
      });
    } catch {
      res.status(400).json({ error: 'Sessão de autorização expirada ou inválida' });
    }
  });

  router.post('/interaction/:uid/finish', urlencoded({ extended: false, limit: '8kb' }), requireAuth, async (req, res) => {
    if (!isOwnAppOrigin(req) || !validConsentToken(req.body?.csrf, req.params.uid as string, requireUserId(req))) {
      res.status(403).send('Autorização recusada');
      return;
    }
    try {
      const interaction = await interactionForUser(provider, req, res);
      if (!interaction) {
        res.status(400).send('Solicitação OAuth inválida');
        return;
      }
      if (req.body.decision !== 'approve') {
        await provider.interactionFinished(req, res, { error: 'access_denied' }, { mergeWithLastSubmission: false });
        return;
      }
      const { details, scopes, clientId } = interaction;
      const userId = requireUserId(req);
      if (details.prompt.name === 'login') {
        await provider.interactionFinished(req, res, { login: { accountId: userId, remember: false } }, { mergeWithLastSubmission: false });
        return;
      }
      if (details.prompt.name !== 'consent') {
        res.status(400).send('Solicitação OAuth inválida');
        return;
      }
      const resource = oauthSettings().resource;
      const grant = new provider.Grant({ accountId: userId, clientId });
      const financeScopes = scopes.filter((scope) => ALLOWED_SCOPES.has(scope));
      grant.addResourceScope(resource, financeScopes);
      // oidc-provider checks both its generic scope consent and resource scope consent.
      grant.addOIDCScope(scopes);
      const grantId = await grant.save();
      const client = await provider.Client.find(clientId);
      const clientName = client?.clientName || clientId;
      await prisma.oAuthConnection.upsert({
        where: { userId_clientId: { userId, clientId } },
        create: { userId, clientId, clientName, grantId, scopes: financeScopes.join(' ') },
        update: { clientName, grantId, scopes: financeScopes.join(' '), revokedAt: null, createdAt: new Date() },
      });
      // Existing access tokens are invalidated immediately by grantId mismatch
      // in getOAuthGrantSubject; leave old provider interactions to expire.
      await provider.interactionFinished(req, res, { consent: { grantId } }, { mergeWithLastSubmission: false });
    } catch {
      if (!res.headersSent) res.status(400).send('Sessão de autorização expirada ou inválida');
    }
  });

  router.use(provider.callback());
  return router;
}

/** Public metadata router; mount at backend root and proxy /.well-known/* via nginx. */
export function createOAuthDiscoveryRouter(provider = getOAuthProvider()) {
  const router = Router();
  router.get(['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/api/oauth'], (_req, res) => {
    const issuer = provider.issuer;
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      revocation_endpoint: `${issuer}/token/revocation`,
      jwks_uri: `${issuer}/jwks`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
      token_endpoint_auth_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      // oidc-provider@9.12.2 includes `iss` in authorization-code redirects
      // and redirectable authorization errors (RFC 9207).
      authorization_response_iss_parameter_supported: true,
      // Mirrors the configured CIMD feature, allowing ChatGPT to discover it.
      client_id_metadata_document_supported: true,
      scopes_supported: [...ALLOWED_SCOPES, 'openid', 'offline_access'],
    });
  });
  router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp'], (_req, res) => {
    res.json({
      resource: oauthSettings().resource,
      authorization_servers: [provider.issuer],
      scopes_supported: [...ALLOWED_SCOPES],
      bearer_methods_supported: ['header'],
    });
  });
  return router;
}
