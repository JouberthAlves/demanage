import type { Adapter, AdapterPayload } from 'oidc-provider';

import { type Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

/** Prisma-backed adapter for oidc-provider. No token or session lives in process memory. */
export class OAuthPrismaAdapter implements Adapter {
  constructor(private readonly model: string) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    const expiresAt = expiresIn === undefined
      ? null
      : new Date(Date.now() + expiresIn * 1_000);
    const data = {
      payload: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
      grantId: payload.grantId ?? null,
      userCode: payload.userCode ?? null,
      uid: payload.uid ?? null,
      expiresAt,
    };
    await prisma.oAuthArtifact.upsert({
      where: { model_id: { model: this.model, id } },
      create: { model: this.model, id, ...data },
      update: data,
    });
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const item = await prisma.oAuthArtifact.findUnique({
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
    const item = await prisma.oAuthArtifact.findUnique({
      where: { model_id: { model: this.model, id } },
      select: { payload: true },
    });
    if (!item) return;
    const payload = item.payload as Record<string, unknown>;
    await prisma.oAuthArtifact.updateMany({
      where: { model: this.model, id },
      data: {
        payload: { ...payload, consumed: Math.floor(Date.now() / 1_000) } as Prisma.InputJsonObject,
      },
    });
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
