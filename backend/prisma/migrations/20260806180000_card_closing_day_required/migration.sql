-- Ensure legacy rows have a closing day before NOT NULL
UPDATE "Card" SET "closingDay" = 1 WHERE "closingDay" IS NULL;

ALTER TABLE "Card" ALTER COLUMN "closingDay" SET NOT NULL;
