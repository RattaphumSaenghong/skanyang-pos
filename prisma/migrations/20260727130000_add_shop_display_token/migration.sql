-- Per-shop secret for the customer display screens.
-- Display endpoints are excluded from IpWhitelistMiddleware (see app.module.ts)
-- and carry no auth, while shop ids are guessable ("shop-1"), so live quotation
-- data was readable by anyone who guessed one. The screens are legitimately
-- unauthenticated, so a shop-scoped token is the right control rather than
-- JwtAuthGuard.
ALTER TABLE "Shop" ADD COLUMN     "displayToken" TEXT;

-- Backfill existing shops with a random token. gen_random_uuid() is built in
-- on Postgres 13+.
UPDATE "Shop" SET "displayToken" = gen_random_uuid()::text WHERE "displayToken" IS NULL;

ALTER TABLE "Shop" ALTER COLUMN "displayToken" SET NOT NULL;
CREATE UNIQUE INDEX "Shop_displayToken_key" ON "Shop"("displayToken");
