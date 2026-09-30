ALTER TABLE "Card"
ADD COLUMN "pendingClosingDay" INTEGER,
ADD COLUMN "pendingClosingDaySetAt" TIMESTAMP(3),
ADD COLUMN "minimumNextClosingOn" TIMESTAMP(3),
ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "Expense"
ADD COLUMN "billingPeriodStart" TIMESTAMP(3),
ADD COLUMN "billingPeriodEnd" TIMESTAMP(3);
