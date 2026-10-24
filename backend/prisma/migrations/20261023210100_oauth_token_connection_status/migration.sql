-- Consent does not mean that the OAuth client completed the token exchange.
-- Existing grants remain authorized; only retained issuance evidence is backfilled.
ALTER TABLE "OAuthConnection" ADD COLUMN "connectedAt" TIMESTAMP(3);

-- A still-retained access-token artifact is evidence that the code exchange
-- completed before this migration. Expired artifacts already pruned cannot
-- establish that fact and deliberately remain pending.
UPDATE "OAuthConnection" AS c
SET "connectedAt" = issued."firstIssuedAt"
FROM (
  SELECT c2."id", MIN(a."createdAt") AS "firstIssuedAt"
  FROM "OAuthConnection" AS c2
  JOIN "OAuthArtifact" AS a
    ON a."model" = 'AccessToken'
   AND a."grantId" = c2."grantId"
   AND a."payload"->>'accountId' = c2."userId"
   AND a."payload"->>'clientId' = c2."clientId"
  WHERE c2."revokedAt" IS NULL
  GROUP BY c2."id"
) AS issued
WHERE c."id" = issued."id";
