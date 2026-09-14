-- Reverses migration.sql in this directory. Applied by `npm run db:migrate:down`
-- (scripts/migrate-down.mjs), which is how the up/down test exercises rollback.

DROP INDEX "public"."upload_sessions_folder_id_idx";
DROP INDEX "public"."upload_sessions_project_id_idx";
DROP INDEX "public"."folders_parent_folder_id_idx";
DROP INDEX "public"."folders_project_id_idx";
DROP INDEX "public"."files_folder_id_idx";
DROP INDEX "public"."files_project_id_idx";
DROP INDEX "public"."deletion_requests_reviewed_by_idx";
DROP INDEX "public"."branding_settings_updated_by_idx";
