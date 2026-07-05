-- =====================================================================
-- H.A.M.D ERP — PostgreSQL Row-Level Security Migration
-- PRODUCTION ONLY. Provided for the day the project cuts over from
-- SQLite (dev sandbox) to PostgreSQL (production).
--
-- This file is intentionally NOT executed in the current SQLite
-- environment (SQLite has no native RLS). Tenant isolation in this
-- sandbox is enforced equivalently via Prisma middleware that injects
-- `tenant_id` from the session context on every query — see
-- src/core/tenancy/middleware.ts. The middleware stays identical after
-- the PostgreSQL cutover; RLS simply adds a second defense-in-depth
-- layer at the database itself.
-- =====================================================================

-- 1. Enable RLS on every tenant-scoped table.
ALTER TABLE "User"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalLine"     ENABLE ROW LEVEL SECURITY;

-- 2. Tenant isolation policy.
-- The application sets the current tenant per connection/transaction via:
--   SET LOCAL app.current_tenant_id = '<uuid>';
-- (executed by the tenancy middleware around every request).
CREATE POLICY tenant_isolation_user        ON "User"         USING (tenant_id = current_setting('app.current_tenant_id')::text);
CREATE POLICY tenant_isolation_account     ON "Account"      USING (tenant_id = current_setting('app.current_tenant_id')::text);
CREATE POLICY tenant_isolation_journal     ON "JournalEntry" USING (tenant_id = current_setting('app.current_tenant_id')::text);

-- JournalLine has no tenant_id column itself (it inherits scope via its
-- JournalEntry). The policy joins to the parent.
CREATE POLICY tenant_isolation_journal_line ON "JournalLine"
  USING (
    EXISTS (
      SELECT 1 FROM "JournalEntry" je
      WHERE je.id = "JournalLine".journal_entry_id
        AND je.tenant_id = current_setting('app.current_tenant_id')::text
    )
  );

-- 3. Tenant table itself: readable only by its own members.
CREATE POLICY tenant_isolation_tenant ON "Tenant"
  USING (
    id = current_setting('app.current_tenant_id')::text
  );

-- 4. Force the policy even for table owners (defense in depth).
ALTER TABLE "User"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "Account"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry" FORCE ROW LEVEL SECURITY;
ALTER TABLE "JournalLine"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "Tenant"       FORCE ROW LEVEL SECURITY;
