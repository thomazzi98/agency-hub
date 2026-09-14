-- Reverses migration.sql in this directory. Applied by `npm run db:migrate:down`
-- (scripts/migrate-down.mjs), which is how the up/down test exercises rollback.

DROP TABLE "public"."pending_requests";

DROP TYPE "public"."pending_request_status";
