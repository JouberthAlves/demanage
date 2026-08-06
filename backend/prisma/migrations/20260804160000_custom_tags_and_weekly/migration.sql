-- CreateEnum
CREATE TYPE "CustomTagScope" AS ENUM ('expense', 'income');

-- AlterEnum ExpenseFrequency
ALTER TYPE "ExpenseFrequency" ADD VALUE 'semanal';

-- AlterEnum EntryFrequency
ALTER TYPE "EntryFrequency" ADD VALUE 'semanal';

-- CreateTable
CREATE TABLE "CustomTag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "CustomTagScope" NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomTag_pkey" PRIMARY KEY ("id")
);

-- AlterTable Expense
ALTER TABLE "Expense" ADD COLUMN "customTagId" TEXT;

-- AlterTable Entry
ALTER TABLE "Entry" ADD COLUMN "customTagId" TEXT;

-- CreateIndex
CREATE INDEX "CustomTag_userId_scope_idx" ON "CustomTag"("userId", "scope");
CREATE UNIQUE INDEX "CustomTag_userId_scope_name_key" ON "CustomTag"("userId", "scope", "name");
CREATE INDEX "Expense_customTagId_idx" ON "Expense"("customTagId");
CREATE INDEX "Entry_customTagId_idx" ON "Entry"("customTagId");

-- AddForeignKey
ALTER TABLE "CustomTag" ADD CONSTRAINT "CustomTag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_customTagId_fkey" FOREIGN KEY ("customTagId") REFERENCES "CustomTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_customTagId_fkey" FOREIGN KEY ("customTagId") REFERENCES "CustomTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
