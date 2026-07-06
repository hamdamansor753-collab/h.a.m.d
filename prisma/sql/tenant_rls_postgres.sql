-- =====================================================================
-- H.A.M.D ERP — PostgreSQL Row-Level Security Migration
-- PRODUCTION. Execute on the PostgreSQL database after running
-- `prisma db push` or `prisma migrate deploy`.
--
-- This enables RLS on EVERY tenant-scoped table and creates a policy
-- that filters rows by `current_setting('app.current_tenant_id')`.
-- The application MUST set this session variable per request:
--   SET LOCAL app.current_tenant_id = '<tenant_id>';
-- (executed by the tenancy context setup around every request).
--
-- With RLS enabled + FORCE, even if the application middleware is
-- bypassed, the database itself rejects cross-tenant queries.
-- This is true defense-in-depth: two independent layers of isolation.
--
-- NOTE: Prisma creates columns in camelCase (e.g., "tenantId" not
-- tenant_id). The policies below use the quoted camelCase names.
-- =====================================================================

-- 1. Enable + Force RLS on every tenant-scoped table.

-- Core tenancy
ALTER TABLE "Tenant"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry"      ENABLE ROW LEVEL SECURITY;

-- Phase 1: Accounting
ALTER TABLE "Invoice"           ENABLE ROW LEVEL SECURITY;

-- Phase 2: Inventory
ALTER TABLE "Warehouse"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Product"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrder"     ENABLE ROW LEVEL SECURITY;

-- Phase 4: HR
ALTER TABLE "Employee"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayrollRun"        ENABLE ROW LEVEL SECURITY;

-- Phase 5: CRM
ALTER TABLE "Customer"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityLog"       ENABLE ROW LEVEL SECURITY;

-- 2. Tenant isolation policies.
-- Each policy filters by: "tenantId" = current_setting('app.current_tenant_id')::text
-- (Prisma uses camelCase column names, quoted in SQL)

-- Core
CREATE POLICY tenant_isolation_tenant       ON "Tenant"        USING (id = current_setting('app.current_tenant_id')::text);
CREATE POLICY tenant_isolation_user         ON "User"          USING ("tenantId" = current_setting('app.current_tenant_id')::text);
CREATE POLICY tenant_isolation_account      ON "Account"       USING ("tenantId" = current_setting('app.current_tenant_id')::text);
CREATE POLICY tenant_isolation_journal      ON "JournalEntry"  USING ("tenantId" = current_setting('app.current_tenant_id')::text);

-- Phase 1
CREATE POLICY tenant_isolation_invoice      ON "Invoice"       USING ("tenantId" = current_setting('app.current_tenant_id')::text);

-- Phase 2
CREATE POLICY tenant_isolation_warehouse    ON "Warehouse"     USING ("tenantId" = current_setting('app.current_tenant_id')::text);
CREATE POLICY tenant_isolation_product      ON "Product"       USING ("tenantId" = current_setting('app.current_tenant_id')::text);
CREATE POLICY tenant_isolation_stock_move   ON "StockMovement" USING ("tenantId" = current_setting('app.current_tenant_id')::text);
CREATE POLICY tenant_isolation_purchase     ON "PurchaseOrder" USING ("tenantId" = current_setting('app.current_tenant_id')::text);

-- Phase 4
CREATE POLICY tenant_isolation_employee     ON "Employee"      USING ("tenantId" = current_setting('app.current_tenant_id')::text);
CREATE POLICY tenant_isolation_payroll      ON "PayrollRun"    USING ("tenantId" = current_setting('app.current_tenant_id')::text);

-- Phase 5
CREATE POLICY tenant_isolation_customer     ON "Customer"      USING ("tenantId" = current_setting('app.current_tenant_id')::text);
CREATE POLICY tenant_isolation_appt         ON "Appointment"   USING ("tenantId" = current_setting('app.current_tenant_id')::text);
CREATE POLICY tenant_isolation_activity     ON "ActivityLog"   USING ("tenantId" = current_setting('app.current_tenant_id')::text);

-- 3. FORCE the policy even for table owners (defense in depth).
ALTER TABLE "Tenant"          FORCE ROW LEVEL SECURITY;
ALTER TABLE "User"            FORCE ROW LEVEL SECURITY;
ALTER TABLE "Account"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "JournalEntry"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "Invoice"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "Warehouse"       FORCE ROW LEVEL SECURITY;
ALTER TABLE "Product"         FORCE ROW LEVEL SECURITY;
ALTER TABLE "StockMovement"   FORCE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrder"   FORCE ROW LEVEL SECURITY;
ALTER TABLE "Employee"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "PayrollRun"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "Customer"        FORCE ROW LEVEL SECURITY;
ALTER TABLE "Appointment"     FORCE ROW LEVEL SECURITY;
ALTER TABLE "ActivityLog"     FORCE ROW LEVEL SECURITY;

-- 4. Verification queries (run manually to confirm RLS is active):
--    SELECT tablename, rowsecurity, forcerowsecurity FROM pg_tables
--    WHERE schemaname = 'public' AND rowsecurity = true;
--
--    Expected: all 14 tables above show rowsecurity=true, forcerowsecurity=true.
--
-- 5. RLS rejection test (run manually after deployment):
--    -- Set tenant A
--    SET app.current_tenant_id = 'tenant-afak';
--    SELECT count(*) FROM "User";  -- returns only tenant-afak users
--
--    -- Set tenant B
--    SET app.current_tenant_id = 'tenant-noor';
--    SELECT count(*) FROM "User";  -- returns only tenant-noor users
--
--    -- Without setting the variable (should return 0 rows)
--    RESET app.current_tenant_id;
--    SELECT count(*) FROM "User";  -- returns 0 (no context = no access)
