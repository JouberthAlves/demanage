-- A user-deleted manual expense is void, not just hidden. Preserve all
-- historical payments for audit; older archived expenses remain unaffected.
ALTER TABLE "Expense" ADD COLUMN "voidedAt" TIMESTAMP(3);
