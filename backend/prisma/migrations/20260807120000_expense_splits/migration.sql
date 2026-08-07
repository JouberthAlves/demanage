-- CreateEnum
CREATE TYPE "ExpenseSplitKind" AS ENUM ('card', 'pix');

-- CreateTable
CREATE TABLE "ExpenseSplit" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "kind" "ExpenseSplitKind" NOT NULL,
    "cardId" TEXT,
    "percent" DECIMAL(5,2) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseSplit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseSplit_expenseId_idx" ON "ExpenseSplit"("expenseId");

-- CreateIndex
CREATE INDEX "ExpenseSplit_cardId_idx" ON "ExpenseSplit"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseSplit_expenseId_kind_cardId_key" ON "ExpenseSplit"("expenseId", "kind", "cardId");

-- AddForeignKey
ALTER TABLE "ExpenseSplit" ADD CONSTRAINT "ExpenseSplit_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseSplit" ADD CONSTRAINT "ExpenseSplit_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: expenses with a card become a single 100% card split
INSERT INTO "ExpenseSplit" ("id", "expenseId", "kind", "cardId", "percent", "amount", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  e."id",
  'card'::"ExpenseSplitKind",
  e."cardId",
  100,
  e."amount",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Expense" e
WHERE e."cardId" IS NOT NULL
  AND e."isInvoice" = false;
