-- Reverses migration.sql in this directory. Applied by `npm run db:migrate:down`
-- (scripts/migrate-down.mjs), which is how the up/down test exercises rollback.

DROP TABLE "public"."topic_replies";
DROP TABLE "public"."topics";
DROP TABLE "public"."comments";

DROP TYPE "public"."topic_status";
DROP TYPE "public"."topic_related_type";
DROP TYPE "public"."commentable_type";
DROP TYPE "public"."priority";
