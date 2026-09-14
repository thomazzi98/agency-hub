-- Row-Level Security, the second and independent layer of tenant isolation
-- (docs/sdd/14-database-design.md#row-level-security-defense-in-depth-and-how-prisma-must-use-it).
--
-- These policies only bite because the application connects as a role that is
-- neither a superuser nor the owner of these tables; PostgreSQL ignores RLS for
-- both. See apps/api/scripts/provision-app-role.mjs.
--
-- Both settings are derived server-side from the already-authenticated actor and
-- are applied with set_config(..., is_local => true) inside an interactive
-- transaction, so they cannot leak onto a pooled connection between requests.

CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.bypass_rls', true), 'false') = 'true'
$$;

CREATE OR REPLACE FUNCTION app_current_company_ids() RETURNS uuid[]
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('app.current_company_ids', true), ''), '{}')::uuid[]
$$;

ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "companies"
  USING (app_bypass_rls() OR "id" = ANY (app_current_company_ids()));

ALTER TABLE "company_memberships" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "company_memberships"
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

-- audit_logs is append-only by design (16-security-requirements.md#audited-actions).
-- Granting only SELECT and INSERT policies means UPDATE and DELETE are denied by
-- the database itself, not merely by convention in application code.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_read ON "audit_logs" FOR SELECT
  USING (app_bypass_rls() OR "company_id" = ANY (app_current_company_ids()));

CREATE POLICY audit_append ON "audit_logs" FOR INSERT
  WITH CHECK (true);
