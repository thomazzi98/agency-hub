-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('in_app', 'push');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_id" UUID NOT NULL,
    "company_id" UUID,
    "type" VARCHAR(80) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "actor_id" UUID,
    "related_type" VARCHAR(40),
    "related_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "push_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh_key" TEXT NOT NULL,
    "auth_key" TEXT NOT NULL,
    "user_agent" VARCHAR(400),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_type_related_type_related_id_idx" ON "notifications"("recipient_id", "type", "related_type", "related_id");

-- CreateIndex
CREATE INDEX "notifications_company_id_idx" ON "notifications"("company_id");

-- CreateIndex
CREATE INDEX "notifications_actor_id_idx" ON "notifications"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_event_type_channel_key" ON "notification_preferences"("user_id", "event_type", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_endpoint_key" ON "push_devices"("endpoint");

-- CreateIndex
CREATE INDEX "push_devices_user_id_enabled_idx" ON "push_devices"("user_id", "enabled");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preferences and push devices belong to a person rather than to a company, so their
-- policies need to know who is asking. Same shape as app_current_company_ids(): read
-- from a transaction-local setting that only tenant-scope.ts writes, never from input.
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- Notifications are scoped by company, exactly like every other tenant-owned table.
--
-- A per-recipient read policy was tried first and does not work: PostgreSQL applies
-- SELECT policies to `INSERT ... ON CONFLICT` and to any `UPDATE` whose WHERE touches
-- the table, so a policy that hid other people's rows would also stop the service
-- collapsing a burst onto the row it just addressed to them. Deduplication and a
-- per-recipient read policy are mutually exclusive at the database level.
--
-- Company scoping is what the spec actually requires of the database here — "a user
-- never receives a notification about a resource in a company they don't have access
-- to" (08-notifications-and-push.md#tenant-isolation). Restricting a reader to their
-- own rows is enforced in application code, where every query filters on recipient_id,
-- and is covered by its own tests.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "notifications"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()))
  WITH CHECK (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

-- Deduplication is this index, not a read-then-write: the service upserts on it, so a
-- burst of events collapses into one unread row
-- (08-notifications-and-push.md#deduplication--anti-spam-concrete-parameters).
-- NULLS NOT DISTINCT is what makes it cover notifications with no related resource.
CREATE UNIQUE INDEX "notifications_unread_dedup_idx"
  ON "notifications" ("recipient_id", "type", "related_type", "related_id")
  NULLS NOT DISTINCT
  WHERE "read_at" IS NULL;

-- Preferences and devices carry no company_id, so the policy is the user check alone.
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON "notification_preferences"
  USING (app_bypass_rls() OR "user_id" = app_current_user_id())
  WITH CHECK (app_bypass_rls() OR "user_id" = app_current_user_id());

ALTER TABLE "push_devices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON "push_devices"
  USING (app_bypass_rls() OR "user_id" = app_current_user_id())
  WITH CHECK (app_bypass_rls() OR "user_id" = app_current_user_id());

-- The unread badge is on every screen, and unread rows are the minority once the
-- product has been in use (17-performance-requirements.md#indexing).
CREATE INDEX "notifications_unread_idx"
  ON "notifications" ("recipient_id", "created_at" DESC)
  WHERE "read_at" IS NULL;
