-- AlterTable Card: replace dueDay with expiresAt + lastInvoicedOn
ALTER TABLE "Card" ADD COLUMN "expiresAt" TIMESTAMP(3);
ALTER TABLE "Card" ADD COLUMN "lastInvoicedOn" TIMESTAMP(3);
ALTER TABLE "Card" DROP COLUMN "dueDay";

-- AlterTable Expense: invoice flag
ALTER TABLE "Expense" ADD COLUMN "isInvoice" BOOLEAN NOT NULL DEFAULT false;
