-- Reverses migration.sql in this directory. Applied by `npm run db:migrate:down`
-- (scripts/migrate-down.mjs), which is how the up/down test exercises rollback.

DROP TABLE "public"."folders";
DROP TABLE "public"."projects";

DROP TYPE "public"."project_status";
DROP TYPE "public"."project_type";
