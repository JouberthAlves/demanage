-- Preserve existing entries while allowing a separate description for new and edited income.
ALTER TABLE "Entry" ADD COLUMN "notes" TEXT;
