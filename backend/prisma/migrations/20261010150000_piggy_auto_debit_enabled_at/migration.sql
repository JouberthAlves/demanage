-- Auto-debit must not back-fill months before it was switched on.
--
-- Hand-written SQL (no database was available when this was written).
--
-- "autoDebitEnabledAt" is the instant auto-debit was last turned on (NULL while
-- off). Cycles are listed from max("createdAt", "autoDebitEnabledAt").
--
-- Backfill: banks with auto-debit already on get the first instant of the
-- CURRENT America/Sao_Paulo month. That keeps this month's behaviour exactly as
-- before (every due day of the month is still >= the enabled day) while never
-- creating debits for older months that earlier code would have back-filled
-- from "createdAt". Prisma stores DateTime as timestamp(3) in UTC, hence the
-- double AT TIME ZONE (local month start -> timestamptz -> UTC wall clock).

-- AlterTable
ALTER TABLE "PiggyBank" ADD COLUMN "autoDebitEnabledAt" TIMESTAMP(3);

UPDATE "PiggyBank"
SET "autoDebitEnabledAt" = (
  date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')
  AT TIME ZONE 'America/Sao_Paulo'
) AT TIME ZONE 'UTC'
WHERE "autoDebit" = true;
