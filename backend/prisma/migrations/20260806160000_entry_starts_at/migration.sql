-- AlterTable
ALTER TABLE "Entry" ADD COLUMN "startsAt" TIMESTAMP(3);

-- Backfill: início = dia de recebimento no mês de criação
UPDATE "Entry"
SET "startsAt" = make_timestamptz(
  EXTRACT(YEAR FROM "createdAt")::int,
  EXTRACT(MONTH FROM "createdAt")::int,
  LEAST(
    COALESCE("receiveDay", 1),
    EXTRACT(DAY FROM (
      date_trunc('month', "createdAt") + interval '1 month' - interval '1 day'
    ))::int
  ),
  12, 0, 0,
  'UTC'
)
WHERE "frequency" IN ('mensal', 'semanal')
  AND "startsAt" IS NULL;
