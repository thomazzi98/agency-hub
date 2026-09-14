-- CreateEnum
CREATE TYPE "backup_job_status" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateTable
CREATE TABLE "backup_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requested_by" UUID,
    "status" "backup_job_status" NOT NULL DEFAULT 'queued',
    "file_name" VARCHAR(200),
    "file_size_bytes" BIGINT,
    "storage_path" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "downloaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_jobs_status_created_at_idx" ON "backup_jobs"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "backup_jobs_requested_by_idx" ON "backup_jobs"("requested_by");

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A backup is the whole database, so it is not tenant data and there is no company to
-- scope it by. The policy is therefore the role check itself: `app.bypass_rls` is set
-- only for an authenticated agency_admin and for the worker's system scope, so an
-- ordinary member's transaction sees no rows here at all — the same rule application
-- code enforces, stated once more where it cannot be forgotten
-- (11-backup-and-recovery.md, 14-database-design.md).
ALTER TABLE "backup_jobs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON "backup_jobs"
  USING (app_bypass_rls())
  WITH CHECK (app_bypass_rls());

-- "Only one manual backup request may be in flight at a time, system-wide"
-- (11-backup-and-recovery.md). Expressed as a unique index on a constant so two
-- simultaneous requests cannot both pass a read-then-write check — the same shape the
-- singleton branding row uses.
CREATE UNIQUE INDEX "backup_jobs_single_flight_idx"
  ON "backup_jobs" ((true))
  WHERE "status" IN ('queued', 'processing');
