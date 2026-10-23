import type { Prisma } from '@/generated/prisma/client';
import { unauthorized } from '@/http/errors';
import { withUserWriteLockTransaction } from '@/lib/user-write-transaction';

type ConsentedOAuthClient = {
  clientId: string;
  clientName: string;
  grantId: string;
  scopes: string[];
};

/** Serialize consent with account recovery so an old session cannot restore revoked access. */
export async function persistOAuthConsentForSession(
  userId: string,
  sessionVersion: number,
  client: ConsentedOAuthClient,
) {
  return withUserWriteLockTransaction(userId, async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { sessionVersion: true },
    });
    if (!user || user.sessionVersion !== sessionVersion) return false;
    await tx.oAuthConnection.upsert({
      where: { userId_clientId: { userId, clientId: client.clientId } },
      create: {
        userId,
        clientId: client.clientId,
        clientName: client.clientName,
        grantId: client.grantId,
        scopes: client.scopes.join(' '),
      },
      update: {
        clientName: client.clientName,
        grantId: client.grantId,
        scopes: client.scopes.join(' '),
        revokedAt: null,
        createdAt: new Date(),
        connectedAt: null,
      },
    });
    return true;
  });
}

/**
 * Final authorization fence inside the SAME locked transaction as an MCP
 * ledger write. A request may have passed bearer verification before account
 * recovery, client revocation or replacement of the client's grant.
 */
export async function assertOAuthGrantActiveForFinancialWrite(
  tx: Pick<Prisma.TransactionClient, 'oAuthConnection' | 'oAuthArtifact'>,
  identity: { userId: string; clientId: string; oauthGrantId: string },
) {
  const { userId, clientId, oauthGrantId } = identity;
  if (!userId || !clientId || !oauthGrantId) {
    throw unauthorized('Autorização MCP expirada ou revogada');
  }

  const [connection, grant] = await Promise.all([
    tx.oAuthConnection.findUnique({
      where: { userId_clientId: { userId, clientId } },
      select: {
        userId: true,
        clientId: true,
        grantId: true,
        scopes: true,
        revokedAt: true,
      },
    }),
    tx.oAuthArtifact.findUnique({
      where: { model_id: { model: 'Grant', id: oauthGrantId } },
      select: { expiresAt: true },
    }),
  ]);
  const scopes = connection?.scopes.split(' ') ?? [];
  if (
    !connection ||
    connection.revokedAt ||
    connection.grantId !== oauthGrantId ||
    !grant ||
    (grant.expiresAt && grant.expiresAt <= new Date()) ||
    !scopes.includes('finance:read') ||
    !scopes.includes('finance:write')
  ) {
    throw unauthorized('Autorização MCP expirada ou revogada');
  }
}
