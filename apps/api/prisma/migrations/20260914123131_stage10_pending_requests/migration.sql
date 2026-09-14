-- CreateEnum
CREATE TYPE "pending_request_status" AS ENUM ('open', 'awaiting_client', 'answered', 'in_review', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "pending_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "project_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "responsible_user_id" UUID NOT NULL,
    "created_by" UUID,
    "due_date" DATE,
    "priority" "priority" NOT NULL DEFAULT 'medium',
    "status" "pending_request_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_requests_company_id_status_created_at_idx" ON "pending_requests"("company_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "pending_requests_responsible_user_id_status_idx" ON "pending_requests"("responsible_user_id", "status");

-- CreateIndex
CREATE INDEX "pending_requests_created_by_status_idx" ON "pending_requests"("created_by", "status");

-- CreateIndex
CREATE INDEX "pending_requests_company_id_due_date_idx" ON "pending_requests"("company_id", "due_date");

-- CreateIndex
CREATE INDEX "pending_requests_project_id_idx" ON "pending_requests"("project_id");

-- AddForeignKey
ALTER TABLE "pending_requests" ADD CONSTRAINT "pending_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_requests" ADD CONSTRAINT "pending_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_requests" ADD CONSTRAINT "pending_requests_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_requests" ADD CONSTRAINT "pending_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every tenant-owned table gets its RLS policy in the migration that creates it.
ALTER TABLE "pending_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "pending_requests"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

-- "What is still open for this company" is the list every screen opens on, and an
-- open request is the minority of rows once the product has been in use for a while
-- (14-database-design.md#indexing-strategy).
CREATE INDEX "pending_requests_unfinished_idx"
  ON "pending_requests" ("company_id", "due_date")
  WHERE "status" IN ('open', 'awaiting_client', 'answered', 'in_review');
