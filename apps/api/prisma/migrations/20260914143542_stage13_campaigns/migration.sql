-- CreateEnum
CREATE TYPE "ad_platform" AS ENUM ('meta', 'tiktok');

-- CreateEnum
CREATE TYPE "ad_account_status" AS ENUM ('active', 'paused', 'closed');

-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('active', 'paused', 'ended', 'with_problem', 'awaiting_approval', 'needs_attention');

-- CreateTable
CREATE TABLE "ad_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "platform" "ad_platform" NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "external_account_id" VARCHAR(120),
    "status" "ad_account_status" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "ad_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "ad_account_id" UUID NOT NULL,
    "platform" "ad_platform" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "objective" VARCHAR(160),
    "status" "campaign_status" NOT NULL DEFAULT 'active',
    "daily_budget" DECIMAL(14,2),
    "total_budget" DECIMAL(14,2),
    "reported_spend" DECIMAL(14,2),
    "reported_balance" DECIMAL(14,2),
    "last_checked_at" TIMESTAMPTZ(6),
    "visible_to_client" BOOLEAN NOT NULL DEFAULT true,
    "responsible_user_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaign_id" UUID NOT NULL,
    "changed_by" UUID,
    "field_name" VARCHAR(60) NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ad_accounts_company_id_status_idx" ON "ad_accounts"("company_id", "status");

-- CreateIndex
CREATE INDEX "ad_accounts_created_by_idx" ON "ad_accounts"("created_by");

-- CreateIndex
CREATE INDEX "campaigns_company_id_status_idx" ON "campaigns"("company_id", "status");

-- CreateIndex
CREATE INDEX "campaigns_company_id_visible_to_client_idx" ON "campaigns"("company_id", "visible_to_client");

-- CreateIndex
CREATE INDEX "campaigns_ad_account_id_idx" ON "campaigns"("ad_account_id");

-- CreateIndex
CREATE INDEX "campaigns_responsible_user_id_idx" ON "campaigns"("responsible_user_id");

-- CreateIndex
CREATE INDEX "campaigns_created_by_idx" ON "campaigns"("created_by");

-- CreateIndex
CREATE INDEX "campaign_history_campaign_id_created_at_idx" ON "campaign_history"("campaign_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "campaign_history_changed_by_idx" ON "campaign_history"("changed_by");

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ad_account_id_fkey" FOREIGN KEY ("ad_account_id") REFERENCES "ad_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_responsible_user_id_fkey" FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_history" ADD CONSTRAINT "campaign_history_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_history" ADD CONSTRAINT "campaign_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every tenant-owned table gets its RLS policy in the migration that creates it.
ALTER TABLE "ad_accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ad_accounts"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "campaigns"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

-- campaign_history carries no company_id of its own; it is reachable only through its
-- campaign, the same shape publications use to reach one through their content.
--
-- It is also append-only, and that is enforced here rather than trusted to application
-- code: granting SELECT and INSERT policies and no others means the database itself
-- refuses an UPDATE or a DELETE. The accountability record this module exists for
-- cannot be quietly rewritten (16-security-requirements.md), exactly as audit_logs.
ALTER TABLE "campaign_history" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "campaign_history" FOR SELECT
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "campaigns" c
       WHERE c."id" = "campaign_history"."campaign_id"
         AND c."company_id" = ANY (app_current_company_ids())
    )
  );

CREATE POLICY campaign_history_append ON "campaign_history" FOR INSERT
  WITH CHECK (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1 FROM "campaigns" c
       WHERE c."id" = "campaign_history"."campaign_id"
         AND c."company_id" = ANY (app_current_company_ids())
    )
  );
