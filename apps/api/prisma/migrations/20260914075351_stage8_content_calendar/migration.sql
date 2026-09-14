-- CreateEnum
CREATE TYPE "content_type" AS ENUM ('video', 'image', 'carousel', 'story', 'reels', 'youtube_short', 'text', 'custom');

-- CreateEnum
CREATE TYPE "production_status" AS ENUM ('planned', 'awaiting_material', 'in_production', 'in_review', 'approved', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "content" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "project_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "type" "content_type" NOT NULL DEFAULT 'custom',
    "scheduled_at" TIMESTAMPTZ(6) NOT NULL,
    "responsible_user_id" UUID,
    "related_file_id" UUID,
    "production_status" "production_status" NOT NULL DEFAULT 'planned',
    "priority" "priority" NOT NULL DEFAULT 'medium',
    "notes" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "content_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_company_id_scheduled_at_idx" ON "content"("company_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "content_company_id_production_status_idx" ON "content"("company_id", "production_status");

-- CreateIndex
CREATE INDEX "content_responsible_user_id_scheduled_at_idx" ON "content"("responsible_user_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "content_project_id_idx" ON "content"("project_id");

-- CreateIndex
CREATE INDEX "content_related_file_id_idx" ON "content"("related_file_id");

-- CreateIndex
CREATE INDEX "content_created_by_idx" ON "content"("created_by");

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_related_file_id_fkey" FOREIGN KEY ("related_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every tenant-owned table gets its RLS policy in the migration that creates it.
ALTER TABLE "content" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "content"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

-- Content is soft-deleted, so the calendar's range query filters on deleted_at. A
-- partial index keeps the common case small (14-database-design.md#indexing-strategy).
CREATE INDEX "content_calendar_live_idx"
  ON "content" ("company_id", "scheduled_at")
  WHERE "deleted_at" IS NULL;
