CREATE TABLE "ExpensePayment" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpensePayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntryReceipt" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntryReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpensePayment_expenseId_month_key"
ON "ExpensePayment"("expenseId", "month");

CREATE UNIQUE INDEX "EntryReceipt_entryId_month_key"
ON "EntryReceipt"("entryId", "month");

ALTER TABLE "ExpensePayment"
ADD CONSTRAINT "ExpensePayment_expenseId_fkey"
FOREIGN KEY ("expenseId") REFERENCES "Expense"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EntryReceipt"
ADD CONSTRAINT "EntryReceipt_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "Entry"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "Expense"
SET "occurredAt" = "createdAt"
WHERE "frequency" = 'unica' AND "occurredAt" IS NULL;

-- Preserve the last explicitly marked payment/receipt that the previous schema
-- could represent. Older cycles are not reconstructed from the due schedule.
INSERT INTO "ExpensePayment"
    ("id", "expenseId", "month", "amount", "paidAt")
SELECT
    gen_random_uuid()::text,
    e."id",
    e."paidForMonth",
    CASE
      WHEN EXISTS (
        SELECT 1 FROM "ExpenseSplit" s WHERE s."expenseId" = e."id"
      ) THEN COALESCE((
        SELECT SUM(s."amount")
        FROM "ExpenseSplit" s
        WHERE s."expenseId" = e."id" AND s."kind" = 'pix'
      ), 0)
      WHEN e."cardId" IS NULL THEN e."amount"
      ELSE 0
    END,
    COALESCE(e."paidAt", e."updatedAt")
FROM "Expense" e
WHERE e."paidForMonth" IS NOT NULL
  AND CASE
    WHEN EXISTS (
      SELECT 1 FROM "ExpenseSplit" s WHERE s."expenseId" = e."id"
    ) THEN COALESCE((
      SELECT SUM(s."amount")
      FROM "ExpenseSplit" s
      WHERE s."expenseId" = e."id" AND s."kind" = 'pix'
    ), 0)
    WHEN e."cardId" IS NULL THEN e."amount"
    ELSE 0
  END > 0;

INSERT INTO "EntryReceipt"
    ("id", "entryId", "month", "amount", "receivedAt")
SELECT
    gen_random_uuid()::text,
    e."id",
    e."receivedForMonth",
    e."amount",
    COALESCE(e."receivedAt", e."updatedAt")
FROM "Entry" e
WHERE e."receivedForMonth" IS NOT NULL;
