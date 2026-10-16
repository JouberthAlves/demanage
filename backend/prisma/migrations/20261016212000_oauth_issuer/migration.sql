CREATE TABLE "OAuthArtifact" (
  "model" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "grantId" TEXT,
  "userCode" TEXT,
  "uid" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthArtifact_pkey" PRIMARY KEY ("model","id")
);
CREATE INDEX "OAuthArtifact_model_grantId_idx" ON "OAuthArtifact"("model","grantId");
CREATE INDEX "OAuthArtifact_model_userCode_idx" ON "OAuthArtifact"("model","userCode");
CREATE INDEX "OAuthArtifact_model_uid_idx" ON "OAuthArtifact"("model","uid");
CREATE INDEX "OAuthArtifact_expiresAt_idx" ON "OAuthArtifact"("expiresAt");

CREATE TABLE "OAuthConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "clientName" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "scopes" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "OAuthConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OAuthConnection_grantId_key" ON "OAuthConnection"("grantId");
CREATE UNIQUE INDEX "OAuthConnection_userId_clientId_key" ON "OAuthConnection"("userId","clientId");
CREATE INDEX "OAuthConnection_userId_revokedAt_idx" ON "OAuthConnection"("userId","revokedAt");
ALTER TABLE "OAuthConnection" ADD CONSTRAINT "OAuthConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
