import { prisma } from '@/lib/prisma';

const CLEANUP_BATCH_LIMIT = 2_000;
const CLEANUP_INTERVAL_MS = 60_000;

/** Bounded PostgreSQL cleanup: never touches non-expiring grants or active tokens. */
export async function pruneExpiredOAuthArtifacts(
  now = new Date(),
  limit = CLEANUP_BATCH_LIMIT,
): Promise<number> {
  if (
    !(now instanceof Date) || Number.isNaN(now.getTime()) ||
    !Number.isSafeInteger(limit) || limit < 1 || limit > CLEANUP_BATCH_LIMIT
  ) {
    throw new RangeError('Invalid OAuth artifact cleanup boundary');
  }
  return prisma.$executeRaw`
    DELETE FROM "OAuthArtifact"
    WHERE ("model", "id") IN (
      SELECT "model", "id"
      FROM "OAuthArtifact"
      WHERE "expiresAt" IS NOT NULL AND "expiresAt" <= ${now}
      ORDER BY "expiresAt" ASC
      LIMIT ${limit}
    )
  `;
}

let cleanupTimer: NodeJS.Timeout | null = null;
let running = false;

function cleanupOneBatch() {
  if (running) return;
  running = true;
  void pruneExpiredOAuthArtifacts().catch((error: unknown) => {
    // Never log OAuth payloads or tokens, including SQL parameters.
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.warn('[oauth] expired artifact cleanup failed', name);
  }).finally(() => {
    running = false;
  });
}

/** Run once per backend process while MCP OAuth is enabled. Unref to allow clean shutdown. */
export function startOAuthArtifactCleanup() {
  if (cleanupTimer) return;
  cleanupOneBatch();
  cleanupTimer = setInterval(cleanupOneBatch, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}
