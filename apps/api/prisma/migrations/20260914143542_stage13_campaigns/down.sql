-- Reverses migration.sql in this directory. Applied by `npm run db:migrate:down`
-- (scripts/migrate-down.mjs), which is how the up/down test exercises rollback.

DROP TABLE "public"."campaign_history";
DROP TABLE "public"."campaigns";
DROP TABLE "public"."ad_accounts";

DROP TYPE "public"."campaign_status";
DROP TYPE "public"."ad_account_status";
DROP TYPE "public"."ad_platform";
