-- AlterEnum
ALTER TYPE "ExpenseCategory" ADD VALUE 'cofrinho';

-- CreateEnum
CREATE TYPE "PiggyTransactionType" AS ENUM ('deposit', 'withdraw');

-- CreateEnum
CREATE TYPE "PiggyTransactionSource" AS ENUM ('manual', 'auto_debit');

-- CreateTable
CREATE TABLE "PiggyBank" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goalAmount" DECIMAL(12,2) NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "monthlyGoal" DECIMAL(12,2) NOT NULL,
    "autoDebit" BOOLEAN NOT NULL DEFAULT false,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PiggyBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PiggyTransaction" (
    "id" TEXT NOT NULL,
    "piggyBankId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PiggyTransactionType" NOT NULL,
    "source" "PiggyTransactionSource" NOT NULL DEFAULT 'manual',
    "amount" DECIMAL(12,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "expenseId" TEXT,
    "entryId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PiggyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PiggyBank_userId_idx" ON "PiggyBank"("userId");

-- CreateIndex
CREATE INDEX "PiggyBank_userId_archivedAt_idx" ON "PiggyBank"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "PiggyTransaction_piggyBankId_idx" ON "PiggyTransaction"("piggyBankId");

-- CreateIndex
CREATE INDEX "PiggyTransaction_userId_idx" ON "PiggyTransaction"("userId");

-- CreateIndex
CREATE INDEX "PiggyTransaction_piggyBankId_type_source_date_idx" ON "PiggyTransaction"("piggyBankId", "type", "source", "date");

-- AddForeignKey
ALTER TABLE "PiggyBank" ADD CONSTRAINT "PiggyBank_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PiggyTransaction" ADD CONSTRAINT "PiggyTransaction_piggyBankId_fkey" FOREIGN KEY ("piggyBankId") REFERENCES "PiggyBank"("id") ON DELETE CASCADE ON UPDATE CASCADE;
