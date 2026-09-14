-- CreateEnum
CREATE TYPE "priority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "commentable_type" AS ENUM ('company', 'project', 'file', 'content', 'pending_request');

-- CreateEnum
CREATE TYPE "topic_related_type" AS ENUM ('project', 'content', 'campaign', 'pending_request', 'file');

-- CreateEnum
CREATE TYPE "topic_status" AS ENUM ('open', 'awaiting_response', 'in_review', 'resolved', 'cancelled');

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "commentable_type" "commentable_type" NOT NULL,
    "commentable_id" UUID NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "attachment_file_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "initial_message" TEXT NOT NULL,
    "creator_id" UUID,
    "responsible_user_id" UUID NOT NULL,
    "related_type" "topic_related_type",
    "related_id" UUID,
    "priority" "priority" NOT NULL DEFAULT 'medium',
    "due_date" DATE,
    "status" "topic_status" NOT NULL DEFAULT 'awaiting_response',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_replies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "topic_id" UUID NOT NULL,
    "author_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comments_commentable_type_commentable_id_created_at_idx" ON "comments"("commentable_type", "commentable_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_company_id_created_at_idx" ON "comments"("company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "comments_author_id_idx" ON "comments"("author_id");

-- CreateIndex
CREATE INDEX "comments_attachment_file_id_idx" ON "comments"("attachment_file_id");

-- CreateIndex
CREATE INDEX "topics_company_id_status_created_at_idx" ON "topics"("company_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "topics_responsible_user_id_status_idx" ON "topics"("responsible_user_id", "status");

-- CreateIndex
CREATE INDEX "topics_creator_id_status_idx" ON "topics"("creator_id", "status");

-- CreateIndex
CREATE INDEX "topic_replies_topic_id_created_at_idx" ON "topic_replies"("topic_id", "created_at");

-- CreateIndex
CREATE INDEX "topic_replies_author_id_idx" ON "topic_replies"("author_id");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_attachment_file_id_fkey" FOREIGN KEY ("attachment_file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_replies" ADD CONSTRAINT "topic_replies_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topic_replies" ADD CONSTRAINT "topic_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every tenant-owned table gets its RLS policy in the migration that creates it.
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "comments"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

ALTER TABLE "topics" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "topics"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

-- topic_replies carries no company_id of its own; it is reachable only through its
-- topic, so its policy follows that topic rather than duplicating the column.
ALTER TABLE "topic_replies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "topic_replies"
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "topics" t
       WHERE t."id" = "topic_replies"."topic_id"
         AND t."company_id" = ANY (app_current_company_ids())
    )
  );

-- Comments are soft-deleted, so every listing filters on deleted_at.
CREATE INDEX "comments_live_thread_idx"
  ON "comments" ("commentable_type", "commentable_id", "created_at")
  WHERE "deleted_at" IS NULL;
