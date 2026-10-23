-- C04: a referenced bank/operation must belong to the same user as its child.
-- Both relationships already use ON DELETE CASCADE. No user data is rewritten.
--
-- Fail closed on legacy owner mismatches: repairing or reassigning financial
-- history automatically could attach it to the wrong account. Inspect any
-- failures manually using the join predicates below before retrying.
-- Explicit transaction makes preflight + DDL atomic on PostgreSQL. The short
-- lock on the two child tables prevents a concurrent owner mismatch from
-- slipping in between the preflight and the new constraints.
BEGIN;
LOCK TABLE "PiggyTransaction", "FinanceMcpUndo" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PiggyTransaction" AS t
    JOIN "PiggyBank" AS b ON b."id" = t."piggyBankId"
    WHERE t."userId" <> b."userId"
  ) THEN
    RAISE EXCEPTION 'C04 migration blocked: PiggyTransaction references a bank owned by another user. Inspect and repair these rows manually.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "FinanceMcpUndo" AS u
    JOIN "FinanceMcpOperation" AS o ON o."id" = u."operationId"
    WHERE u."userId" <> o."userId"
  ) THEN
    RAISE EXCEPTION 'C04 migration blocked: FinanceMcpUndo references an operation owned by another user. Inspect and repair these rows manually.';
  END IF;
END $$;

-- The existing globally unique IDs remain primary keys. PostgreSQL requires
-- a separate UNIQUE constraint/index on the exact composite FK target.
CREATE UNIQUE INDEX "PiggyBank_id_userId_key"
  ON "PiggyBank"("id", "userId");
CREATE UNIQUE INDEX "FinanceMcpOperation_id_userId_key"
  ON "FinanceMcpOperation"("id", "userId");
-- Keep the original UNIQUE(operationId) for the 1:1 contract. Prisma also
-- requires uniqueness on the full compound relation fields.
CREATE UNIQUE INDEX "FinanceMcpUndo_operationId_userId_key"
  ON "FinanceMcpUndo"("operationId", "userId");

-- Add the new ownership checks before dropping the original single-ID FKs.
-- NOT VALID reduces the initial validation lock; new writes are checked
-- immediately. VALIDATE must succeed before the old FKs can be dropped.
-- ON UPDATE NO ACTION prevents silently transferring financial children to a
-- newly assigned owner if the parent userId is ever changed.
ALTER TABLE "PiggyTransaction"
  ADD CONSTRAINT "PiggyTransaction_piggyBankId_userId_fkey"
  FOREIGN KEY ("piggyBankId", "userId")
  REFERENCES "PiggyBank"("id", "userId")
  ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;
ALTER TABLE "FinanceMcpUndo"
  ADD CONSTRAINT "FinanceMcpUndo_operationId_userId_fkey"
  FOREIGN KEY ("operationId", "userId")
  REFERENCES "FinanceMcpOperation"("id", "userId")
  ON DELETE CASCADE ON UPDATE NO ACTION NOT VALID;

ALTER TABLE "PiggyTransaction"
  VALIDATE CONSTRAINT "PiggyTransaction_piggyBankId_userId_fkey";
ALTER TABLE "FinanceMcpUndo"
  VALIDATE CONSTRAINT "FinanceMcpUndo_operationId_userId_fkey";

ALTER TABLE "PiggyTransaction"
  DROP CONSTRAINT "PiggyTransaction_piggyBankId_fkey";
ALTER TABLE "FinanceMcpUndo"
  DROP CONSTRAINT "FinanceMcpUndo_operationId_fkey";

COMMIT;
