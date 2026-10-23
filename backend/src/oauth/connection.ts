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
