/*
  Warnings:

  - You are about to drop the column `userId` on the `Card` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Entry` table. All the data in the column will be lost.
  - You are about to drop the column `userId` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the `User` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Card" DROP CONSTRAINT "Card_userId_fkey";

-- DropForeignKey
ALTER TABLE "Entry" DROP CONSTRAINT "Entry_userId_fkey";

-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_userId_fkey";

-- DropIndex
DROP INDEX "Card_userId_idx";

-- DropIndex
DROP INDEX "Entry_userId_idx";

-- DropIndex
DROP INDEX "Expense_userId_idx";

-- AlterTable
ALTER TABLE "Card" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "Entry" DROP COLUMN "userId";

-- AlterTable
ALTER TABLE "Expense" DROP COLUMN "userId";

-- DropTable
DROP TABLE "User";
