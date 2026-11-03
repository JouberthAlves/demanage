-- Add immutable-by-period salary rates and independent outstanding holds.
-- No existing receipts, entry amounts or legacy fields are modified.
CREATE TABLE "SalaryVersion" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "receiveDay" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalaryVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalaryHold" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalaryHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalaryVersion_entryId_month_key" ON "SalaryVersion"("entryId", "month");
CREATE UNIQUE INDEX "SalaryHold_entryId_month_key" ON "SalaryHold"("entryId", "month");
ALTER TABLE "SalaryVersion" ADD CONSTRAINT "SalaryVersion_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalaryHold" ADD CONSTRAINT "SalaryHold_entryId_fkey"
  FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Legacy records contain only the latest salary; earlier edits cannot be reconstructed.
-- The earliest known baseline uses the schedule start (when available) or the entry creation month.
INSERT INTO "SalaryVersion" ("id", "entryId", "month", "amount", "receiveDay")
SELECT gen_random_uuid()::text, e."id",
       TO_CHAR(COALESCE(e."startsAt"::date, (e."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date), 'YYYY-MM'),
       e."amount", COALESCE(e."receiveDay", 1)
FROM "Entry" e WHERE e."type" = 'salario' AND e."frequency" = 'mensal';

INSERT INTO "SalaryHold" ("id", "entryId", "month")
SELECT gen_random_uuid()::text, e."id", e."receiptHoldForMonth"
FROM "Entry" e
WHERE e."type" = 'salario' AND e."frequency" = 'mensal'
  AND e."receiptHoldForMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$';
