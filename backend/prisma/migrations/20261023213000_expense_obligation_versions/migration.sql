-- New recorded versions apply only from their chosen competence forward.
-- Existing expenses are intentionally NOT backfilled using today's mutable
-- values: prior edits may have destroyed evidence of historical amounts.
CREATE TABLE "ExpenseObligationVersion" (
  "id" TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "effectiveMonth" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "cardId" TEXT,
  "splits" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpenseObligationVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExpenseObligationVersion_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ExpenseObligationVersion_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "ExpenseObligationVersion_month_check" CHECK ("effectiveMonth" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "ExpenseObligationVersion_sequence_check" CHECK ("sequence" > 0)
);
CREATE UNIQUE INDEX "ExpenseObligationVersion_expenseId_sequence_key" ON "ExpenseObligationVersion"("expenseId", "sequence");
CREATE INDEX "ExpenseObligationVersion_expenseId_effectiveMonth_sequence_idx" ON "ExpenseObligationVersion"("expenseId", "effectiveMonth", "sequence");

-- Fail closed on any SQL UPDATE, even outside the application: revisions are
-- append-only and old values cannot be rewritten in place.
CREATE FUNCTION prevent_expense_obligation_version_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'expense obligation versions are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ExpenseObligationVersion_append_only"
BEFORE UPDATE ON "ExpenseObligationVersion"
FOR EACH ROW EXECUTE FUNCTION prevent_expense_obligation_version_update();
