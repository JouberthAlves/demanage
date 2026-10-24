-- Explicit server-assigned provenance: user-controlled notes are never authority.
-- Historic rows remain NULL (unverifiable) and are rejected as ambiguous.
CREATE TYPE "PiggyCorrectionOrigin" AS ENUM ('debited', 'not_debited');
ALTER TABLE "PiggyTransaction"
  ADD COLUMN "correctionOrigin" "PiggyCorrectionOrigin";

ALTER TABLE "PiggyTransaction"
  ADD CONSTRAINT "PiggyTransaction_correction_origin_consistency" CHECK (
    "correctionOrigin" IS NULL OR (
      "type" = 'withdraw' AND "source" = 'manual' AND (
        ("correctionOrigin" = 'debited' AND "entryId" IS NOT NULL) OR
        ("correctionOrigin" = 'not_debited' AND "entryId" IS NULL)
      )
    )
  );

CREATE FUNCTION prevent_piggy_correction_origin_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."correctionOrigin" IS DISTINCT FROM NEW."correctionOrigin" THEN
    RAISE EXCEPTION 'Piggy correction provenance is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PiggyTransaction_correction_origin_immutable"
BEFORE UPDATE OF "correctionOrigin" ON "PiggyTransaction"
FOR EACH ROW EXECUTE FUNCTION prevent_piggy_correction_origin_change();
