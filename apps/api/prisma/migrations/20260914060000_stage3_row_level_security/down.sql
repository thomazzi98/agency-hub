-- Reverses migration.sql in this directory. Applied by `npm run db:migrate:down`
-- (scripts/migrate-down.mjs), which is how the up/down test exercises rollback.

DROP POLICY IF EXISTS audit_append ON "audit_logs";
DROP POLICY IF EXISTS audit_read ON "audit_logs";
ALTER TABLE "audit_logs" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "company_memberships";
ALTER TABLE "company_memberships" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "companies";
ALTER TABLE "companies" DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS app_current_company_ids();
DROP FUNCTION IF EXISTS app_bypass_rls();
