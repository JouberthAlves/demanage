ALTER TABLE "User"
ADD COLUMN "recoveryCodeHash" TEXT,
ADD COLUMN "recoveryCodeCreatedAt" TIMESTAMP(3),
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
