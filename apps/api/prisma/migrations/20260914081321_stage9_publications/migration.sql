-- CreateEnum
CREATE TYPE "publication_network" AS ENUM ('instagram', 'facebook', 'tiktok', 'youtube_shorts');

-- CreateEnum
CREATE TYPE "publication_status" AS ENUM ('not_planned', 'planned', 'scheduled', 'published', 'not_published', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "content_id" UUID NOT NULL,
    "network" "publication_network" NOT NULL,
    "status" "publication_status" NOT NULL DEFAULT 'planned',
    "published_at" TIMESTAMPTZ(6),
    "link" VARCHAR(2048),
    "responsible_user_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publications_status_published_at_idx" ON "publications"("status", "published_at");

-- CreateIndex
CREATE INDEX "publications_responsible_user_id_idx" ON "publications"("responsible_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "publications_content_id_network_key" ON "publications"("content_id", "network");

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- publications carries no company_id of its own; it is reachable only through its
-- content row, so its policy follows that content rather than duplicating the column
-- (14-database-design.md: "publications via content.company_id").
ALTER TABLE "publications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "publications"
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "content" c
       WHERE c."id" = "publications"."content_id"
         AND c."company_id" = ANY (app_current_company_ids())
    )
  );

-- The production board counts publications still owed across a company, which reaches
-- them through content. Without this the planner has only the (content_id, network)
-- unique index, which does not help a status-first scan.
CREATE INDEX "publications_pending_idx"
  ON "publications" ("content_id")
  WHERE "status" IN ('planned', 'scheduled');
