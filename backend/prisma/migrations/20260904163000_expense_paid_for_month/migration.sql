-- Track which monthly cycle of a recurring expense was paid manually in advance.
ALTER TABLE "Expense" ADD COLUMN "paidForMonth" TEXT;
