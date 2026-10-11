-- Ledger integrity hardening.
--
-- Hand-written SQL (no database was available when this was written). Prisma
-- cannot express partial indexes or CHECK constraints, so schema.prisma documents
-- them and this migration creates them. Names follow Prisma's conventions so
-- `prisma migrate diff` sees the foreign keys and ordinary indexes as expected.
--
-- Preflight behaviour (fail closed, no money history is deleted):
--   * PiggyTransaction.userId must reference an existing User (the DO block raises).
--   * ExpenseSplit must not hold two pix rows for the same expense and kind.
--   * closingDay, pendingClosingDay, receiveDay and autoDebitDay must be 1..31
--     (the API already enforces this; existing bad data fails the CHECK).
--   * Dangling PiggyTransaction.expenseId / entryId are set to NULL (SET NULL
--     semantics: the referenced ledger row no longer exists).

-- 1. Redundant indexes. Each is a leading-column prefix of a composite or unique
--    index that already exists, so no query plan loses an index it needs.
DROP INDEX "Expense_userId_idx";
DROP INDEX "Entry_userId_idx";
DROP INDEX "PiggyBank_userId_idx";
DROP INDEX "PiggyTransaction_piggyBankId_idx";
DROP INDEX "ExpenseSplit_expenseId_idx";
DROP INDEX "CustomTag_userId_scope_idx";
DROP INDEX "MarketDataCache_provider_key_at_idx";

-- 2. PiggyTransaction.userId was never a foreign key.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PiggyTransaction" AS t
    WHERE NOT EXISTS (SELECT 1 FROM "User" AS u WHERE u."id" = t."userId")
  ) THEN
    RAISE EXCEPTION 'PiggyTransaction rows reference a missing User. Resolve them manually, then rerun this migration.';
  END IF;
END $$;

ALTER TABLE "PiggyTransaction"
ADD CONSTRAINT "PiggyTransaction_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Ledger references become SET NULL on delete. Clear dangling ids first.
UPDATE "PiggyTransaction" AS t
SET "expenseId" = NULL
WHERE t."expenseId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Expense" AS e WHERE e."id" = t."expenseId");

UPDATE "PiggyTransaction" AS t
SET "entryId" = NULL
WHERE t."entryId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Entry" AS e WHERE e."id" = t."entryId");

ALTER TABLE "PiggyTransaction"
ADD CONSTRAINT "PiggyTransaction_expenseId_fkey"
FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PiggyTransaction"
ADD CONSTRAINT "PiggyTransaction_entryId_fkey"
FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PiggyTransaction_expenseId_idx" ON "PiggyTransaction"("expenseId");
CREATE INDEX "PiggyTransaction_entryId_idx" ON "PiggyTransaction"("entryId");

-- 4. Pix splits have NULL cardId, which the composite unique ignores (NULLs are distinct).
CREATE UNIQUE INDEX "ExpenseSplit_expenseId_kind_null_card_key"
ON "ExpenseSplit"("expenseId", "kind")
WHERE "cardId" IS NULL;

-- 5. Day-of-month ranges. The API accepts 1..31 for these fields.
ALTER TABLE "Card"
ADD CONSTRAINT "Card_closingDay_check" CHECK ("closingDay" BETWEEN 1 AND 31),
ADD CONSTRAINT "Card_pendingClosingDay_check" CHECK ("pendingClosingDay" IS NULL OR "pendingClosingDay" BETWEEN 1 AND 31);

ALTER TABLE "Entry"
ADD CONSTRAINT "Entry_receiveDay_check" CHECK ("receiveDay" IS NULL OR "receiveDay" BETWEEN 1 AND 31);

ALTER TABLE "PiggyBank"
ADD CONSTRAINT "PiggyBank_autoDebitDay_check" CHECK ("autoDebitDay" BETWEEN 1 AND 31);
