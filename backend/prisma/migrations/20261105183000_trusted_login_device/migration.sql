-- Opt-in possession factor is deliberately independent of sessionVersion:
-- routine logout revokes JWTs; password reset rotates this epoch and revokes devices.
ALTER TABLE "User" ADD COLUMN "trustedDeviceVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "trustedProofFailures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "trustedProofWindowAt" TIMESTAMP(3);
ALTER TABLE "User" ADD CONSTRAINT "User_trustedProofFailures_check" CHECK ("trustedProofFailures" >= 0 AND "trustedProofFailures" <= 5);

CREATE TABLE "TrustedLoginDevice" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "label" VARCHAR(80) NOT NULL,
  "secretHash" CHAR(64) NOT NULL,
  "credentialVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "failedWindowStartedAt" TIMESTAMP(3),
  CONSTRAINT "TrustedLoginDevice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrustedLoginDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TrustedLoginDevice_failedAttempts_check" CHECK ("failedAttempts" >= 0 AND "failedAttempts" <= 5)
);

CREATE INDEX "TrustedLoginDevice_userId_revokedAt_idx" ON "TrustedLoginDevice"("userId", "revokedAt");
CREATE INDEX "TrustedLoginDevice_expiresAt_idx" ON "TrustedLoginDevice"("expiresAt");

CREATE TABLE "TrustedLoginChallenge" (
  "id" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "proofHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrustedLoginChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrustedLoginChallenge_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "TrustedLoginDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TrustedLoginChallenge_expiresAt_idx" ON "TrustedLoginChallenge"("expiresAt");
CREATE INDEX "TrustedLoginChallenge_deviceId_idx" ON "TrustedLoginChallenge"("deviceId");
