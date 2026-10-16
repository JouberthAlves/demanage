-- PostgreSQL 18 UTF-8/ICU: normalize both Unicode representations and case.
-- Keep display names unchanged; only income tags receive this extra identity.
-- Abort with actionable IDs if existing names collide. Do NOT silently merge:
-- existing Entry rows can refer to either ID and require manual review.
DO $$
DECLARE
    collision RECORD;
BEGIN
    SELECT t."userId", string_agg(t."id" || ':' || t."name", ', ' ORDER BY t."id") AS tags
      INTO collision
      FROM "CustomTag" t
      WHERE t."scope" = 'income'::"CustomTagScope"
      GROUP BY t."userId", normalize(casefold(normalize(t."name", NFKC) COLLATE "und-x-icu"), NFKC)
      HAVING count(*) > 1
      LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION 'Income tag normalization collision: userId=%, tags=%', collision."userId", collision.tags
        USING HINT = 'Review the colliding income tag IDs and rename the duplicates before retrying; no tags were deleted or merged.';
    END IF;
END $$;

-- Functional partial unique indexes are not expressible in Prisma schema.prisma.
CREATE UNIQUE INDEX "CustomTag_income_userId_normalized_name_key"
  ON "CustomTag" (
    "userId",
    (normalize(casefold(normalize("name", NFKC) COLLATE "und-x-icu"), NFKC))
  )
  WHERE "scope" = 'income'::"CustomTagScope";
