-- Reverses migration.sql in this directory. Applied by `npm run db:migrate:down`
-- (scripts/migrate-down.mjs), which is how the up/down test exercises rollback.

DROP TABLE "public"."push_devices";
DROP TABLE "public"."notification_preferences";
DROP TABLE "public"."notifications";

DROP TYPE "public"."notification_channel";

DROP FUNCTION IF EXISTS app_current_user_id();
