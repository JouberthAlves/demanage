-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "startsAt" TIMESTAMP(3);

-- Backfill: início = dia de desconto no mês de criação
UPDATE "Expense"
SET "startsAt" = make_timestamptz(
  EXTRACT(YEAR FROM "createdAt")::int,
  EXTRACT(MONTH FROM "createdAt")::int,
  LEAST(
    COALESCE("dueDay", 1),
    EXTRACT(DAY FROM (
      date_trunc('month', "createdAt") + interval '1 month' - interval '1 day'
    ))::int
  ),
  12, 0, 0,
  'UTC'
)
WHERE "frequency" IN ('mensal', 'semanal')
  AND "isInvoice" = false
  AND "startsAt" IS NULL;
