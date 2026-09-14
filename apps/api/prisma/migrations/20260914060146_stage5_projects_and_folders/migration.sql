-- CreateEnum
CREATE TYPE "project_type" AS ENUM ('property', 'product', 'service', 'event', 'campaign', 'internal', 'other');

-- CreateEnum
CREATE TYPE "project_status" AS ENUM ('planned', 'active', 'paused', 'completed', 'archived');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "code" VARCHAR(40),
    "type" "project_type" NOT NULL DEFAULT 'other',
    "description" TEXT,
    "status" "project_status" NOT NULL DEFAULT 'active',
    "start_date" DATE,
    "end_date" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "project_id" UUID,
    "parent_folder_id" UUID,
    "name" VARCHAR(160) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_company_id_status_idx" ON "projects"("company_id", "status");

-- CreateIndex
CREATE INDEX "projects_company_id_created_at_idx" ON "projects"("company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "projects_created_by_idx" ON "projects"("created_by");

-- CreateIndex
CREATE INDEX "folders_company_id_project_id_idx" ON "folders"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "folders_company_id_parent_folder_id_idx" ON "folders"("company_id", "parent_folder_id");

-- CreateIndex
CREATE INDEX "folders_created_by_idx" ON "folders"("created_by");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_folder_id_fkey" FOREIGN KEY ("parent_folder_id") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every tenant-owned table gets its RLS policy in the same migration that creates
-- it (docs/sdd/14-database-design.md). A table added without one is invisible as a
-- gap: the application-layer filter would still work, and the second layer would
-- silently not exist.
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "projects"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

ALTER TABLE "folders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "folders"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

-- Two folders with the same name in the same place are indistinguishable to a user.
-- NULLS NOT DISTINCT (PostgreSQL 15+) is what makes this hold for the common cases:
-- a folder at the company root has no project and no parent, and a plain unique
-- constraint would treat every such NULL as unique.
CREATE UNIQUE INDEX "folders_unique_name_in_place"
  ON "folders" ("company_id", "project_id", "parent_folder_id", lower("name"))
  NULLS NOT DISTINCT;
