-- Reverses migration.sql in this directory. Applied by `npm run migrate:down`
-- (scripts/migrate-down.mjs), which is how the up/down test exercises rollback.

-- DropTable
DROP TABLE "public"."login_attempts";

-- DropTable
DROP TABLE "public"."audit_logs";

-- DropTable
DROP TABLE "public"."password_reset_audits";

-- DropTable
DROP TABLE "public"."sessions";

-- DropEnum
DROP TYPE "public"."password_reset_action";

-- AlterTable
ALTER TABLE "public"."users"
  DROP COLUMN "failed_login_attempts",
  DROP COLUMN "locked_until";
