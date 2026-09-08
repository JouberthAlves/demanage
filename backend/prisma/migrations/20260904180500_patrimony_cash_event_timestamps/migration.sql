ALTER TABLE "Expense" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "Entry" ADD COLUMN "receivedAt" TIMESTAMP(3);

UPDATE "Expense"
SET "paidAt" = "updatedAt"
WHERE "paidForMonth" IS NOT NULL;

UPDATE "Entry"
SET "receivedAt" = "updatedAt"
WHERE "receivedForMonth" IS NOT NULL;
