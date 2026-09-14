-- CreateEnum
CREATE TYPE "file_status" AS ENUM ('received', 'in_review', 'editing', 'edit_complete', 'approved', 'archived');

-- CreateEnum
CREATE TYPE "upload_session_status" AS ENUM ('pending', 'in_progress', 'completed', 'aborted', 'expired');

-- CreateEnum
CREATE TYPE "deletion_request_target_type" AS ENUM ('file', 'content');

-- CreateEnum
CREATE TYPE "deletion_request_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "project_id" UUID,
    "folder_id" UUID,
    "original_name" VARCHAR(400) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "file_status" NOT NULL DEFAULT 'received',
    "uploaded_by" UUID,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "project_id" UUID,
    "folder_id" UUID,
    "initiated_by" UUID,
    "storage_key" TEXT NOT NULL,
    "original_name" VARCHAR(400) NOT NULL,
    "mime_type" VARCHAR(160) NOT NULL,
    "declared_size_bytes" BIGINT NOT NULL,
    "max_allowed_size_bytes" BIGINT NOT NULL,
    "part_size_bytes" INTEGER NOT NULL,
    "provider_upload_id" TEXT NOT NULL,
    "status" "upload_session_status" NOT NULL DEFAULT 'pending',
    "file_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_parts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "upload_session_id" UUID NOT NULL,
    "part_number" INTEGER NOT NULL,
    "etag" VARCHAR(120) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "target_type" "deletion_request_target_type" NOT NULL,
    "target_id" UUID NOT NULL,
    "requested_by" UUID,
    "reason" VARCHAR(1000) NOT NULL,
    "status" "deletion_request_status" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_company_id_folder_id_status_idx" ON "files"("company_id", "folder_id", "status");

-- CreateIndex
CREATE INDEX "files_company_id_uploaded_at_idx" ON "files"("company_id", "uploaded_at" DESC);

-- CreateIndex
CREATE INDEX "files_company_id_project_id_idx" ON "files"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "files_uploaded_by_idx" ON "files"("uploaded_by");

-- CreateIndex
CREATE UNIQUE INDEX "upload_sessions_file_id_key" ON "upload_sessions"("file_id");

-- CreateIndex
CREATE INDEX "upload_sessions_company_id_status_idx" ON "upload_sessions"("company_id", "status");

-- CreateIndex
CREATE INDEX "upload_sessions_status_last_activity_at_idx" ON "upload_sessions"("status", "last_activity_at");

-- CreateIndex
CREATE INDEX "upload_sessions_initiated_by_idx" ON "upload_sessions"("initiated_by");

-- CreateIndex
CREATE UNIQUE INDEX "upload_parts_upload_session_id_part_number_key" ON "upload_parts"("upload_session_id", "part_number");

-- CreateIndex
CREATE INDEX "deletion_requests_company_id_status_created_at_idx" ON "deletion_requests"("company_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deletion_requests_target_type_target_id_idx" ON "deletion_requests"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "deletion_requests_requested_by_idx" ON "deletion_requests"("requested_by");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_parts" ADD CONSTRAINT "upload_parts_upload_session_id_fkey" FOREIGN KEY ("upload_session_id") REFERENCES "upload_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deletion_requests" ADD CONSTRAINT "deletion_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every tenant-owned table gets its RLS policy in the migration that creates it.
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "files"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

ALTER TABLE "upload_sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "upload_sessions"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

ALTER TABLE "deletion_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "deletion_requests"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

-- upload_parts has no company_id of its own; it is reachable only through its session,
-- so its policy follows that session rather than duplicating the column.
ALTER TABLE "upload_parts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "upload_parts"
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "upload_sessions" s
       WHERE s."id" = "upload_parts"."upload_session_id"
         AND s."company_id" = ANY (app_current_company_ids())
    )
  );

-- A file is soft-deleted, never removed, so every list query filters on deleted_at.
-- A partial index keeps the common case small (14-database-design.md#indexing-strategy).
CREATE INDEX "files_company_folder_live_idx"
  ON "files" ("company_id", "folder_id", "status")
  WHERE "deleted_at" IS NULL;

-- One pending deletion request per target: a second one adds nothing for the reviewer
-- and produces duplicate notifications.
CREATE UNIQUE INDEX "deletion_requests_one_pending_per_target"
  ON "deletion_requests" ("target_type", "target_id")
  WHERE "status" = 'pending';
