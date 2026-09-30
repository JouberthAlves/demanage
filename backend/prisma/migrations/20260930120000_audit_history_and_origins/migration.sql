CREATE TYPE "LedgerOrigin" AS ENUM ('manual', 'piggy', 'asset');

ALTER TABLE "Expense"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "systemOrigin" "LedgerOrigin" NOT NULL DEFAULT 'manual';

ALTER TABLE "Entry"
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "systemOrigin" "LedgerOrigin" NOT NULL DEFAULT 'manual';

CREATE INDEX "Expense_userId_archivedAt_idx"
ON "Expense"("userId", "archivedAt");

CREATE INDEX "Entry_userId_archivedAt_idx"
ON "Entry"("userId", "archivedAt");

UPDATE "Expense" AS ledger
SET "systemOrigin" = 'asset'
FROM "AssetTransaction" AS movement
WHERE movement."expenseId" = ledger."id";

UPDATE "Entry" AS ledger
SET "systemOrigin" = 'asset'
FROM "AssetTransaction" AS movement
WHERE movement."entryId" = ledger."id";

UPDATE "Expense" AS ledger
SET "systemOrigin" = 'piggy'
FROM "PiggyTransaction" AS movement
WHERE movement."expenseId" = ledger."id"
  AND ledger."systemOrigin" = 'manual';

UPDATE "Entry" AS ledger
SET "systemOrigin" = 'piggy'
FROM "PiggyTransaction" AS movement
WHERE movement."entryId" = ledger."id"
  AND ledger."systemOrigin" = 'manual';

-- One-off cash expenses are transactions at their stored occurrence date.
-- Snapshot their amount now so later edits and soft deletion cannot rewrite history.
INSERT INTO "ExpensePayment" ("id", "expenseId", "month", "amount", "paidAt")
SELECT
  gen_random_uuid()::text,
  expense."id",
  to_char(expense."occurredAt", 'YYYY-MM'),
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "ExpenseSplit" split WHERE split."expenseId" = expense."id"
    ) THEN COALESCE((
      SELECT SUM(split."amount")
      FROM "ExpenseSplit" split
      WHERE split."expenseId" = expense."id" AND split."kind" = 'pix'
    ), 0)
    WHEN expense."cardId" IS NULL THEN expense."amount"
    ELSE 0
  END,
  expense."occurredAt"
FROM "Expense" AS expense
WHERE expense."frequency" = 'unica'
  AND expense."systemOrigin" = 'manual'
  AND expense."occurredAt" IS NOT NULL
  AND CASE
    WHEN EXISTS (
      SELECT 1 FROM "ExpenseSplit" split WHERE split."expenseId" = expense."id"
    ) THEN COALESCE((
      SELECT SUM(split."amount")
      FROM "ExpenseSplit" split
      WHERE split."expenseId" = expense."id" AND split."kind" = 'pix'
    ), 0)
    WHEN expense."cardId" IS NULL THEN expense."amount"
    ELSE 0
  END > 0
ON CONFLICT ("expenseId", "month") DO NOTHING;

ALTER TABLE "ExpensePayment" DROP CONSTRAINT "ExpensePayment_expenseId_fkey";
ALTER TABLE "ExpensePayment"
ADD CONSTRAINT "ExpensePayment_expenseId_fkey"
FOREIGN KEY ("expenseId") REFERENCES "Expense"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EntryReceipt" DROP CONSTRAINT "EntryReceipt_entryId_fkey";
ALTER TABLE "EntryReceipt"
ADD CONSTRAINT "EntryReceipt_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "Entry"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
