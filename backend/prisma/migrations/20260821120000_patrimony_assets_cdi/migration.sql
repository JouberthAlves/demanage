ALTER TYPE "ExpenseCategory" ADD VALUE IF NOT EXISTS 'investimento';
ALTER TYPE "PiggyTransactionType" ADD VALUE IF NOT EXISTS 'interest';
ALTER TYPE "PiggyTransactionSource" ADD VALUE IF NOT EXISTS 'yield';

CREATE TYPE "Asset" AS ENUM ('BTC', 'USD');
CREATE TYPE "AssetTransactionType" AS ENUM ('BUY', 'SELL', 'MANUAL_ADJUSTMENT');

ALTER TABLE "Expense" ADD COLUMN "occurredAt" TIMESTAMP(3);
ALTER TABLE "PiggyBank" ADD COLUMN "yieldEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "cdiPercent" DECIMAL(8,4) NOT NULL DEFAULT 0,
ADD COLUMN "interestAccruedThrough" TIMESTAMP(3);
ALTER TABLE "PiggyTransaction" ADD COLUMN "cdiRate" DECIMAL(12,8),
ADD COLUMN "cdiPercent" DECIMAL(8,4),
ADD COLUMN "baseBalance" DECIMAL(18,8),
ADD COLUMN "resultingBalance" DECIMAL(18,8),
ADD COLUMN "interestKey" TEXT;
CREATE UNIQUE INDEX "PiggyTransaction_interestKey_key" ON "PiggyTransaction"("interestKey");
CREATE INDEX "Expense_userId_occurredAt_idx" ON "Expense"("userId", "occurredAt");

CREATE TABLE "PatrimonySettings" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "baseDate" TIMESTAMP(3) NOT NULL,
  "openingCashBrl" DECIMAL(18,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatrimonySettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PatrimonySettings_userId_key" ON "PatrimonySettings"("userId");
ALTER TABLE "PatrimonySettings" ADD CONSTRAINT "PatrimonySettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AssetTransaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "asset" "Asset" NOT NULL,
  "type" "AssetTransactionType" NOT NULL,
  "quantity" DECIMAL(30,12) NOT NULL,
  "cashAmountBrl" DECIMAL(18,8) NOT NULL,
  "feeAmountBrl" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "feePercent" DECIMAL(12,8),
  "costBasisKnown" BOOLEAN NOT NULL DEFAULT true,
  "date" TIMESTAMP(3) NOT NULL,
  "note" TEXT,
  "expenseId" TEXT,
  "entryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AssetTransaction_expenseId_key" ON "AssetTransaction"("expenseId");
CREATE UNIQUE INDEX "AssetTransaction_entryId_key" ON "AssetTransaction"("entryId");
CREATE INDEX "AssetTransaction_userId_asset_date_idx" ON "AssetTransaction"("userId", "asset", "date");
ALTER TABLE "AssetTransaction" ADD CONSTRAINT "AssetTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetTransaction" ADD CONSTRAINT "AssetTransaction_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetTransaction" ADD CONSTRAINT "AssetTransaction_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "MarketDataCache" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL,
  "value" DECIMAL(30,12) NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketDataCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketDataCache_provider_key_at_key" ON "MarketDataCache"("provider", "key", "at");
CREATE INDEX "MarketDataCache_provider_key_at_idx" ON "MarketDataCache"("provider", "key", "at");
