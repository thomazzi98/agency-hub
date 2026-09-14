-- Reverses migration.sql in this directory. Applied by `npm run migrate:down`
-- (scripts/migrate-down.mjs), which is how the up/down test exercises rollback.

-- DropForeignKey
ALTER TABLE "public"."companies" DROP CONSTRAINT "companies_created_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."company_memberships" DROP CONSTRAINT "company_memberships_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."company_memberships" DROP CONSTRAINT "company_memberships_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."company_memberships" DROP CONSTRAINT "company_memberships_created_by_fkey";

-- DropTable
DROP TABLE "public"."users";

-- DropTable
DROP TABLE "public"."companies";

-- DropTable
DROP TABLE "public"."company_memberships";

-- DropEnum
DROP TYPE "public"."user_role";

-- DropEnum
DROP TYPE "public"."user_status";

-- DropEnum
DROP TYPE "public"."company_status";

-- DropEnum
DROP TYPE "public"."membership_status";
