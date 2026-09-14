-- The final review found eight foreign keys with no *leading* index, which
-- 14-database-design.md#indexing-strategy requires of every one of them. The composite
-- indexes on these tables cover the same columns in second position, which does not
-- help: deleting or updating a parent row makes PostgreSQL check the referencing table,
-- and without a leading index that check is a sequential scan. With `onDelete: Restrict`
-- everywhere, that is a scan on every attempted delete.

-- CreateIndex
CREATE INDEX "branding_settings_updated_by_idx" ON "branding_settings"("updated_by");

-- CreateIndex
CREATE INDEX "deletion_requests_reviewed_by_idx" ON "deletion_requests"("reviewed_by");

-- CreateIndex
CREATE INDEX "files_project_id_idx" ON "files"("project_id");

-- CreateIndex
CREATE INDEX "files_folder_id_idx" ON "files"("folder_id");

-- CreateIndex
CREATE INDEX "folders_project_id_idx" ON "folders"("project_id");

-- CreateIndex
CREATE INDEX "folders_parent_folder_id_idx" ON "folders"("parent_folder_id");

-- CreateIndex
CREATE INDEX "upload_sessions_project_id_idx" ON "upload_sessions"("project_id");

-- CreateIndex
CREATE INDEX "upload_sessions_folder_id_idx" ON "upload_sessions"("folder_id");
