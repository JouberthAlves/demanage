-- AlterTable
ALTER TABLE "Entry" ADD COLUMN "receiveDay" INTEGER;
ALTER TABLE "Entry" ADD COLUMN "endsAt" TIMESTAMP(3);

-- Backfill: entradas recorrentes existentes entram no saldo a partir do dia 1
UPDATE "Entry"
SET "receiveDay" = 1
WHERE "frequency" IN ('mensal', 'semanal')
  AND "receiveDay" IS NULL;
