import { type Adapter, type AdapterPayload, errors } from 'oidc-provider';

import { type Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

/** Prisma-backed adapter for oidc-provider. No token or session lives in process memory. */
export class OAuthPrismaAdapter implements Adapter {
  constructor(
    private readonly model: string,
    private readonly artifacts = prisma.oAuthArtifact,
  ) {}

  async upsert(
    id: string,
    payload: AdapterPayload,
    expiresIn?: number,
  ): Promise<void> {
    const expiresAt =
      expiresIn === undefined ? null : new Date(Date.now() + expiresIn * 1_000);
    const data = {
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
      grantId: payload.grantId ?? null,
      userCode: payload.userCode ?? null,
      uid: payload.uid ?? null,
      expiresAt,
    };
    if (this.model === 'ReplayDetection') {
      // oidc-provider calls find() before save(); simultaneous requests can
      // both see a missing JTI. Only INSERT under the (model,id) primary key
      // can decide the winner atomically across processes and connections.
      try {
        await this.artifacts.create({
          data: { model: this.model, id, ...data },
        });
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'P2002'
        ) {
          throw new errors.InvalidClientAuth(
            'client assertion tokens must only be used once',
          );
        }
        throw error;
      }
      return;
    }
    const writeArtifact = (
      repository: Pick<typeof prisma.oAuthArtifact, 'upsert'>,
    ) =>
      repository.upsert({
        where: { model_id: { model: this.model, id } },
        create: { model: this.model, id, ...data },
        update: data,
      });
    if (
      this.model !== 'AccessToken' ||
      !payload.grantId ||
      !payload.accountId ||
      !payload.clientId
    ) {
      await writeArtifact(this.artifacts);
      return;
    }

    // The OAuth consent UI records authorization, while only durable access-token
    // issuance marks the external client's token exchange as completed. Keep
    // both writes atomic and bind them to the live, unrevoked grant to prevent
    // late tokens for an old grant marking a fresh consent as connected.
    await prisma.$transaction(async (tx) => {
      await writeArtifact(tx.oAuthArtifact);
      await tx.oAuthConnection.updateMany({
        where: {
          grantId: payload.grantId,
          userId: payload.accountId,
          clientId: payload.clientId,
          revokedAt: null,
          connectedAt: null,
        },
        data: { connectedAt: new Date() },
      });
    });
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const item = await this.artifacts.findUnique({
      where: { model_id: { model: this.model, id } },
    });
    if (!item || (item.expiresAt && item.expiresAt.getTime() <= Date.now())) {
      return undefined;
    }
    return item.payload as AdapterPayload;
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    return this.findBySecondary('userCode', userCode);
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    return this.findBySecondary('uid', uid);
  }

  private async findBySecondary(key: 'uid' | 'userCode', value: string) {
    const item = await prisma.oAuthArtifact.findFirst({
      where: {
        model: this.model,
        [key]: value,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return item?.payload as AdapterPayload | undefined;
  }

  async consume(id: string): Promise<void> {
    // A token exchange loads the code before calling consume(). Two requests
    // can both observe it as valid, so the consume step MUST be a DB-level CAS.
    // Only the winner can issue tokens; losers receive invalid_grant.
    const changed = await prisma.$executeRaw`
      UPDATE "OAuthArtifact"
      SET "payload" = jsonb_set(
        "payload", '{consumed}'::text[],
        to_jsonb(FLOOR(EXTRACT(EPOCH FROM NOW()))::bigint), true
      )
      WHERE "model" = ${this.model}
        AND "id" = ${id}
        AND NOT ("payload" ? 'consumed')
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
    `;
    if (changed !== 1) {
      throw new errors.InvalidGrant(
        'OAuth credential already consumed or expired',
      );
    }
  }

  async destroy(id: string): Promise<void> {
    await prisma.oAuthArtifact.deleteMany({ where: { model: this.model, id } });
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await prisma.oAuthArtifact.deleteMany({
      where: { model: this.model, grantId },
    });
  }
}
