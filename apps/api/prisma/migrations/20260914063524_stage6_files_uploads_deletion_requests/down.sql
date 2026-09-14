-- Reverses migration.sql in this directory. Applied by `npm run db:migrate:down`
-- (scripts/migrate-down.mjs), which is how the up/down test exercises rollback.

DROP TABLE "public"."upload_parts";
DROP TABLE "public"."upload_sessions";
DROP TABLE "public"."deletion_requests";
DROP TABLE "public"."files";

DROP TYPE "public"."deletion_request_status";
DROP TYPE "public"."deletion_request_target_type";
DROP TYPE "public"."upload_session_status";
DROP TYPE "public"."file_status";
