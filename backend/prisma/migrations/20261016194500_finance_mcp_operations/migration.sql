-- Durable, per-owner/client receipts: both client key and signed-intent nonce
-- are independently unique. The app inserts only after all accounting steps,
-- in the same transaction, and never updates a committed result.
CREATE TABLE "FinanceMcpOperation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "intentNonce" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "actionKind" TEXT NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "result" JSONB NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinanceMcpOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinanceMcpOperation_userId_clientId_idempotencyKey_key"
    ON "FinanceMcpOperation"("userId", "clientId", "idempotencyKey");

CREATE UNIQUE INDEX "FinanceMcpOperation_userId_clientId_intentNonce_key"
    ON "FinanceMcpOperation"("userId", "clientId", "intentNonce");

ALTER TABLE "FinanceMcpOperation"
    ADD CONSTRAINT "FinanceMcpOperation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
