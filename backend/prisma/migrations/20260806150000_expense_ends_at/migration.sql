-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "endsAt" TIMESTAMP(3);

-- Backfill: despesas recorrentes sem dia usam dia 1
UPDATE "Expense"
SET "dueDay" = 1
WHERE "frequency" IN ('mensal', 'semanal')
  AND "dueDay" IS NULL
  AND "isInvoice" = false;
