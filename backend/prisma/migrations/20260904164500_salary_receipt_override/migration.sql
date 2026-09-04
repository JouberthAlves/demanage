-- Allow the salary cycle for a month to wait for manual confirmation or be confirmed early.
ALTER TABLE "Entry"
  ADD COLUMN "receiptHoldForMonth" TEXT,
  ADD COLUMN "receivedForMonth" TEXT;
