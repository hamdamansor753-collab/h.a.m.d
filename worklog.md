# H.A.M.D ERP — Phase 0 (Core) Worklog

This file is the single shared worklog for all agents working on H.A.M.D ERP Phase 0.
Each agent MUST append (never overwrite) a new section delimited by `---` after completing its Task ID.

---
Task ID: 0
Agent: main-orchestrator
Task: Bootstrap Phase 0 plan and environment assessment

Work Log:
- Read all four uploaded spec files (03-architecture-decisions.md, 04-data-model.md, 05-security-baseline.md, 01-brand-identity.md)
- Inspected existing Next.js 16 + Prisma + shadcn/ui scaffold
- Confirmed environment constraint: SQLite only (PostgreSQL RLS at DB layer cannot run here)
- Decision: implement tenant isolation via Prisma middleware (exactly as spec demands) + AsyncLocalStorage tenant context; document PostgreSQL RLS migration as production step

Stage Summary:
- 12 todos created covering foundation, tenancy, i18n, auth, RBAC, ledger, validations, API, middleware, UI, verification
- Will execute sequentially with parallel file writes where independent
- Key deviation to flag to user: SQLite instead of PostgreSQL (RLS middleware equivalent implemented)

---
Task ID: 1-12
Agent: main-orchestrator
Task: Build H.A.M.D ERP Phase 0 (Core) in full — tenancy, auth, RBAC, i18n, ledger, API, UI, verification

Work Log:
- Installed bcryptjs for password hashing
- Wrote full Prisma schema (Tenant, User, Role, Permission, UserRole, Account, AccountType, JournalEntry, JournalLine, Translation) per 04-data-model.md
- Pushed schema to SQLite, ran seed (2 tenants, 3 roles admin/accountant/viewer, 5 demo users, chart of accounts per tenant, ~180 translations across ar-EG/ar-SA/en)
- Wrote PostgreSQL RLS migration SQL (prisma/sql/tenant_rls_postgres.sql) for production cutover
- Built tenancy layer: AsyncLocalStorage context (singleton via globalThis) + Prisma client Proxy that dispatches tenant-scoped models (user/account/journalEntry) to per-tenant $extends clients with closure-captured tenantId
- Built i18n engine: DB-backed translations with in-memory cache, server t(), client I18nProvider, Intl number/date formatters, RTL/LTR auto-switch, 3 locales (ar-EG, ar-SA, en)
- Built auth: NextAuth Credentials provider with bcrypt, JWT sessions carrying tenantId/userId/roleKeys/permissionKeys
- Built RBAC: service-layer requirePermission() helper (fail-closed, no backdoor)
- Built ledger: Account service (tree CRUD), JournalEntry service with mandatory SUM(debit)===SUM(credit) check (integer-cent math) BEFORE any DB write
- Built Zod validation schemas for all inputs (login, createAccount, createJournalEntry, locale)
- Built API routes (all runtime=nodejs, Zod-validated, service-only Prisma): /api/auth/[...nextauth], /api/session, /api/accounts, /api/journal, /api/tests, /api/i18n/dictionary
- Built Next.js edge middleware for early 401 on protected routes
- Built UI: Cairo font, navy/cyan brand tokens in globals.css, RTL default, login screen with demo-account quick-login, dashboard with sidebar (Accounts/Journal/Tests), accounts tree, journal entry form with live balance indicator, tests panel with structured pass/fail output, language switcher
- Debugged two critical issues during verification:
  1. Prisma 6 removed $use middleware → switched to $extends query API
  2. $extends query handlers run in a separate async context that AsyncLocalStorage does not propagate into + Next.js/turbopack module duplication broke ALS singleton → fixed by (a) storing ALS on globalThis, (b) using a Prisma client Proxy that captures tenantId in a closure at extension-creation time (per-tenant extended clients cached in a Map)
- Verified end-to-end with Agent Browser:
  * Login as admin@afak.test (tenant A) → dashboard shows 7 accounts (1000-5000)
  * Created balanced journal entry (Cash 100 / Revenue 100) → 201 Created, displayed with Arabic-Indic date (٥ يوليو ٢٠٢٦)
  * Ran security tests → BOTH PASSED: tenant isolation (cross-tenant read=null, update=0, journal create=blocked) + journal balance (unbalanced rejected, balanced created+cleaned)
  * Switched language to English → UI switched to LTR, all text translated
  * Logged out, logged in as admin@noor.test (tenant B) → dashboard shows 5 DIFFERENT accounts (1100-4100), confirming tenant isolation from user perspective
  * Ran tests as tenant B → BOTH PASSED (otherTenantId=tenant-afak, same blocking results)
  * Lint clean

Stage Summary:
- All 12 todos completed
- Both mandatory security tests PASS from both tenants' perspectives (not theoretical — actually executed against live backend)
- Dev server running on port 3000, all endpoints 200, no runtime errors
- Key architectural decision documented: SQLite in sandbox (no native RLS) → tenant isolation enforced via Prisma client Proxy + per-tenant $extends clients + fail-closed context check. PostgreSQL RLS migration SQL provided for production cutover. The Proxy approach is actually STRONGER than raw RLS in one respect: it fail-closes on missing context rather than silently returning all rows.
- Files produced: ~25 source files across prisma/, src/core/{tenancy,auth,rbac,i18n,ledger}/, src/lib/, src/app/api/{auth,session,accounts,journal,tests,i18n}/, src/components/hamd/, src/app/{layout,page,globals.css}

---
Task ID: 13
Agent: main-orchestrator
Task: Fix login session not persisting — user kicked back to login screen after entering credentials

Work Log:
- Diagnosed via dev.log: POST /api/auth/callback/credentials returned 200 (login succeeds) but subsequent /api/session returned unauthenticated → session cookie not being sent back
- Root cause: NextAuth default cookies use SameSite=Lax, which browsers refuse to send on cross-origin iframe fetches (the preview panel embeds the app in an iframe). Also NEXTAUTH_URL was hardcoded to localhost:3000, so callback-url cookie pointed to the wrong host.
- Fix applied in src/core/auth/options.ts:
  1. Added trustHost: true — NextAuth auto-detects the host from the X-Forwarded-Host header sent by the Caddy gateway
  2. Explicit cookie config with SameSite=None; Secure on all 6 NextAuth cookies (sessionToken, csrfToken, callbackUrl, pkceCodeVerifier, state, nonce) — allows the session cookie to travel with cross-origin iframe fetches
  3. Removed NEXTAUTH_URL from .env (was forcing localhost:3000)
- Added credentials: 'include' to all 10 client-side fetch calls (app-shell, accounts-panel, journal-panel, tests-panel) as belt-and-suspenders
- Fixed logout to use next-auth/react's signOut() instead of a manual fetch (proper CSRF handling)
- Verified: Chromium has a special exception that allows Secure cookies on localhost over HTTP, so agent-browser testing on localhost:3000 still works
- Tested end-to-end: login as admin@afak.test → dashboard appears → accounts load (7 accounts) → security tests PASS → logout → back to login screen. All working.

Stage Summary:
- Login session now persists correctly through the preview panel (HTTPS + cross-origin iframe context)
- The SameSite=None; Secure combination is required for any iframe-embedded app and is the standard NextAuth-behind-proxy configuration
- No changes to the tenancy/auth/RBAC logic — only cookie/transport configuration

---
Task ID: 14-26
Agent: main-orchestrator
Task: Phase 1 — Accounting & Invoicing module + Phase 0 /api/tests fix

Work Log:
- Phase 0 fix: added `system:test` permission (admin only) + `requirePermission('system:test')` at start of POST /api/tests
- Fixed seed to sync permissions on re-seed (previous `update: {}` didn't connect new perms to existing roles)
- Added Invoice, InvoiceLine, InvoiceStatus to Prisma schema (with @unique on journalEntryId + voidJournalEntryId for 1:1 relations)
- Added `invoice` to tenant-scoped models in db.ts Proxy (invoiceLine stays unscoped — inherits via Invoice, like JournalLine via JournalEntry)
- Implemented EgyptTaxProvider (14% VAT, per-line customizable rate, cent-precision rounding, placeholder for ETA XML)
- Refactored journal-entry.service.ts: exported `prepareJournalEntry` (balance check + account verify + explicit tenantId) and `createJournalEntryOn(tx, ...)` for transaction-safe reuse
- Critical fix: `prepareJournalEntry` now includes `tenantId` explicitly in data — required because `tx` inside `$transaction` has NO tenant middleware
- Invoice service: createInvoice, updateInvoice (DRAFT only), deleteInvoice (DRAFT only), postInvoice (tax→balanced JE→atomic tx), voidInvoice (reversing JE)
- postInvoice: uses getTaxProvider(tenantCountry) → calculateTax → builds balanced JE (debit AR=total, credit Revenue=base, credit Tax=tax) → createJournalEntryOn(tx) + tx.invoice.update in single $transaction
- voidInvoice: creates reversing JE (debit↔credit swap) + updates status to VOID in single $transaction. Original JE stays for audit.
- Income statement service: fetches all JournalEntries (tenant-scoped) with lines+accounts, sums by AccountType (Revenue=credit-debit, Expense=debit-credit), returns net income
- All API routes: runtime=nodejs, Zod-validated, auth+permission via withTenantContext, service-only Prisma
- Critical bug fix: `'status' in result` false-positived on invoice objects (which have a `status` field) → changed to `result.status === 401` in ALL routes (accounts, journal, invoices, tests, reports)
- Security fix: `tx.invoice.update` inside $transaction must include `tenantId` in `where` (tx has no middleware)
- UI: invoices-panel (list + create/edit form with live totals + post/void buttons), income-statement-panel (revenue vs expenses vs net income), dashboard nav with 5 sections
- Extended /api/tests with 3 Phase 1 tests (5 total): all PASS

Stage Summary:
- All 5 security tests PASS (verified via Agent Browser):
  1. tenant-isolation: PASS (cross-tenant read=null, update=0, JE create blocked)
  2. journal-balance: PASS (unbalanced rejected, balanced created+cleaned)
  3. invoice-post-balanced: PASS (INV-0011 posted, JE found, debit=1710=credit, tax=210 correct)
  4. posted-invoice-immutable: PASS (PATCH on POSTED rejected with InvoiceStateError)
  5. invoice-tenant-isolation: PASS (cross-tenant read=null, post blocked, update blocked)
- Invoice INV-0010 created via UI (customer=شركة النخبة, 2000+14% tax=2280), posted → JE appears in journal with balanced 2280=2280
- Income statement shows Revenue 2100 (2000 from invoice + 100 from Phase 0 manual entry)
- Lint clean, dev server running on port 3000
- Files produced: ~15 new/modified files across prisma/, src/core/{tax,ledger,auth}/, src/modules/accounting/, src/app/api/{invoices,reports}/, src/components/hamd/

---
Task ID: 27-39
Agent: main-orchestrator
Task: Phase 2 — Inventory & Purchasing module

Work Log:
- Added Warehouse, Product, StockLevel, StockMovement, StockMovementType, PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus to Prisma schema
- Added back-relations on Tenant and JournalEntry (stockMovements, receivedPurchaseOrder)
- Updated db.ts: added warehouse, product, stockMovement, purchaseOrder to tenant-scoped models. StockLevel + PurchaseOrderLine stay unscoped (inherit via parent, like InvoiceLine/JournalLine)
- Built inventory services:
  - product.service.ts: listProducts (with stock levels), getProduct, createProduct
  - warehouse.service.ts: listWarehouses, getWarehouse, createWarehouse, getDefaultWarehouse
  - stock-movement.service.ts: THE SOLE StockLevel writer — recordMovement() creates StockMovement + upserts StockLevel in same tx. Checks insufficient stock for outbound. Also exports computeWeightedAverageCost() (pure function) + getStockLevel + listStockMovements
  - purchase-order.service.ts: CRUD DRAFT + receivePurchaseOrder (per-line StockMovement(RECEIPT) + weighted-avg costPrice update + ONE balanced JE Debit Inventory/Credit AP + link movements to JE, all in db.$transaction)
  - sales-movement.service.ts: recordSale (rejects if insufficient stock via InsufficientStockError + StockMovement(SALE) + COGS JE Debit COGS/Credit Inventory)
- Weighted average cost implementation: newCostPrice = (currentQty×currentCost + receivedQty×receivedUnitCost) / (currentQty + receivedQty). Pools ALL warehouses' stock into one per-product cost (future: per-warehouse). FIFO/LIFO deferred per spec.
- Added Zod validations: createProductSchema, createWarehouseSchema, purchaseOrderLineSchema, createPurchaseOrderSchema. Relaxed productId/warehouseId from uuid() to string().min(1) because seed uses non-UUID warehouse IDs (tenant-afak-wh-main)
- Built API routes (all runtime=nodejs, Zod, service-only): /api/warehouses, /api/products, /api/purchase-orders, /api/purchase-orders/[id], /api/purchase-orders/[id]/receive
- Updated seed: 4 new permissions (inventory:read, inventory:adjust, purchase:create, purchase:receive) synced to admin/accountant/viewer roles. Added Inventory(ASSET), AP(LIABILITY), COGS(EXPENSE) accounts. Added default warehouse per tenant + sample products (PROD-001/002/003 for afak, ITEM-101/102 for noor). ~120 inventory/purchase translations across ar-EG/ar-SA/en
- Updated Next.js middleware to protect /api/warehouses, /api/products, /api/purchase-orders
- Built UI: inventory-panel (products table with stock levels + warehouses list + create forms), purchase-orders-panel (list + create form with product/warehouse selectors + receive button), dashboard nav with 7 sections
- Extended /api/tests with 3 Phase 2 tests (8 total): all PASS
- Fixed two bugs during verification:
  1. Zod uuid() validation rejected non-UUID warehouse IDs → relaxed to string().min(1)
  2. StockMovement.journalEntryId had @unique constraint → blocked linking multiple movements to one PO's JE → removed @unique (multiple movements per JE is the correct design)

Stage Summary:
- All 8 security tests PASS (verified via /api/tests):
  1. tenant-isolation: PASS
  2. journal-balance: PASS
  3. invoice-post-balanced: PASS
  4. posted-invoice-immutable: PASS
  5. invoice-tenant-isolation: PASS
  6. po-receive-stock-je: PASS (stockDelta=15, balanced 1600=1600, movementsCount=2, status=RECEIVED)
  7. insufficient-stock-rejected: PASS (oversell 1040 rejected, stock unchanged 40→40)
  8. inventory-tenant-isolation: PASS (cross-tenant read=null, PO create/receive blocked)
- PO-0001 created via UI (10 units @ 100), received → stock=10, costPrice=100, balanced JE in journal
- Income statement shows Revenue 2100 (from Phase 1 invoices), Expenses 0 (no sales yet)
- Lint clean, dev server running on port 3000
- Files produced: ~18 new/modified files across prisma/, src/modules/inventory/, src/app/api/{warehouses,products,purchase-orders}/, src/components/hamd/, src/lib/{validations,api,db,middleware}

---
Task ID: 40-49
Agent: main-orchestrator
Task: Phase 3 — POS (Point of Sale) module

Work Log:
- Added `channel InvoiceChannel @default(MANUAL)` field + `enum InvoiceChannel { MANUAL, POS }` to Invoice (additive, no existing fields touched)
- Updated invoice.service.ts with two ADDITIVE optional parameters (no logic rewritten):
  - createInvoice: optional `channel?: 'MANUAL' | 'POS'` (default MANUAL)
  - postInvoice: optional `debitAccountId?: string` (default: AR account). When POS passes Cash account ID, it debits Cash instead of AR.
- Built POS service (src/modules/pos/pos-sale.service.ts): single orchestration function `posSale()` that:
  1. Pre-checks ALL lines' stock sufficiency BEFORE any write (the atomicity guarantee — if any line insufficient, throws InsufficientStockError with zero side effects)
  2. Resolves the Cash account (POS debits Cash, not AR)
  3. Gets the tenant's default tax rate from the TaxProvider
  4. Calls createInvoice({ channel: 'POS' }) — Phase 1 service, unchanged
  5. Calls postInvoice(id, { debitAccountId: cash.id }) — Phase 1 service, with optional param
  6. Calls recordSale() for each line — Phase 2 service, unchanged
  7. Returns { invoice, revenueJE, cogsJEs, totalRevenue, totalTax, totalAmount, totalCogs, netProfit }
- NO logic rewritten from invoice.service.ts or sales-movement.service.ts — only called them
- Added Zod validation: posSaleSchema (warehouseId, customerName, lines with productId/quantity/unitPrice)
- Built API route: /api/pos/sale (POST) — runtime=nodejs, auth, permission(pos:sell), Zod, service-only
- Updated seed: pos:sell permission, cashier role (pos:sell + invoice:read + inventory:read), cashier@afak.test user, ~70 POS translations
- Updated middleware to protect /api/pos
- Built POS UI (pos-panel.tsx): product grid with search + stock badges, cart with qty controls + live totals (subtotal + 14% tax + total), checkout button, receipt display with COGS + net profit
- Dashboard: POS is the default view, nav has 8 sections with POS first
- Extended /api/tests with 3 Phase 3 tests (11 total): ALL PASS

Stage Summary:
- All 11 security tests PASS (verified via /api/tests):
  1-8: Phase 0-2 tests all PASS
  9. pos-sale-invoice-stock-je: PASS — invoice channel=POS, stock reduced 82→80 (delta=2), revenue JE balanced (34200=34200), COGS JE balanced (211.80=211.80), COGS=2×105.90=211.80 correct, netProfit=29788.20
  10. pos-insufficient-stock-rejected: PASS — oversell 5080 rejected (InsufficientStockError), stock unchanged 80→80, invoice count unchanged 39→39 (zero side effects)
  11. pos-tenant-isolation: PASS — cross-tenant POS sale blocked (InventoryConfigError), no leaked invoice
- POS sale via UI: clicked PROD-001 (laptop, 15000), checkout → INV-0033 created, stock 55→54, receipt shows subtotal 15000 + tax 2100 = total 17100
- Lint clean, dev server running on port 3000
- Confirmation: NO logic rewritten from invoice.service.ts or sales-movement.service.ts — posSale() only CALLS createInvoice, postInvoice, and recordSale

---
Task ID: 50
Agent: main-orchestrator
Task: Phase 3 atomicity fix — posSale() single-transaction refactor + test 12

Work Log:
- Problem identified: posSale() called createInvoice → postInvoice → recordSale as separate operations, each with their own internal db.$transaction(). A mid-flow failure (e.g., recordSale line 2 fails after postInvoice succeeds) left a partial state: invoice POSTED + revenue JE recorded, but no COGS/stock for line 2.
- Solution: added optional `tx?: Prisma.TransactionClient` parameter to createInvoice, postInvoice, and recordSale (same pattern as recordMovement from Phase 2). When tx is provided:
  - Skips requirePermission (caller — posSale — handles permissions; this also fixes the cashier role bug: cashier has pos:sell but not inventory:adjust, so recordSale's permission check would have failed for cashiers)
  - Uses tx for all reads + writes with explicit tenantId in where/data (Phase 1 rule: tx has no tenant middleware)
  - Does NOT start its own db.$transaction — runs inside the caller's tx
  When tx is NOT provided: standalone behavior unchanged (permission check + own $transaction)
- Refactored posSale() to wrap ALL writes (createInvoice + postInvoice + recordSale per line) inside a SINGLE db.$transaction(async (tx) => { ... }). If ANY step fails — including recordMovement's internal stock check inside recordSale — the entire transaction rolls back: no invoice, no JE, no stock movement.
- Also refactored helper functions to accept client + tenantId:
  - nextInvoiceNumber(client, tenantId) — counts with explicit tenantId
  - resolvePostingAccounts(client, tenantId) — findFirst with explicit tenantId
  - resolveSaleAccounts(client, tenantId) — findFirst with explicit tenantId
- Added test 12 (pos-partial-failure-rollback): proves the atomicity fix by creating a scenario where:
  - 2 lines of the SAME product, each requesting qty = current stock (individually passes pre-check)
  - Combined qty = 2 × stock > stock → line 2's recordSale fails mid-transaction (stock already reduced by line 1)
  - OLD code would leave: invoice POSTED + line 1 COGS + line 1 stock reduced (PARTIAL STATE)
  - NEW code: entire transaction rolls back → zero side effects
  - Test verifies: saleRejected=true, stockUnchanged=true, invoiceCountUnchanged=true, movementCountUnchanged=true, noLeakedInvoice=true

Stage Summary:
- All 12 security tests PASS (verified via /api/tests):
  1-8: Phase 0-2 tests all PASS (unchanged)
  9. pos-sale-invoice-stock-je: PASS — invoice channel=POS, stock reduced, 2 balanced JEs
  10. pos-insufficient-stock-rejected: PASS — oversell rejected, zero side effects
  11. pos-tenant-isolation: PASS — cross-tenant sale blocked
  12. pos-partial-failure-rollback: PASS — scenario "2 lines × 117 units (stock=117), combined=234 > 117", saleRejected=true, stockUnchanged=true (117→117), invoiceCountUnchanged=true (46→46), movementCountUnchanged=true (21→21), noLeakedInvoice=true
- Lint clean, dev server running on port 3000
- NO logic rewritten from invoice.service.ts or sales-movement.service.ts — only added optional tx parameter + client/tenantId to helper functions. Existing standalone callers (API routes) see no behavior change.

---
Task ID: 51-64
Agent: main-orchestrator
Task: Phase 4 — HR & Payroll module

Work Log:
- Added Employee, EmployeeStatus, PayrollRun, PayrollStatus, PayrollLine to Prisma schema + back-relations on Tenant and JournalEntry
- Updated db.ts: added employee, payrollRun to tenant-scoped models. PayrollLine inherits scope via PayrollRun (like InvoiceLine via Invoice)
- Built PayrollRuleProvider interface + registry (src/core/payroll/provider.ts) — same pluggable pattern as TaxProvider
- Built EgyptPayrollRuleProvider (src/core/payroll/egypt-payroll-provider.ts) — SIMPLIFIED calculation clearly marked as placeholder:
  - Flat 10% income tax above 5000 EGP/month threshold (placeholder for progressive brackets)
  - Employee insurance 14% / employer insurance 11% (roughly matching current Egyptian rates, without caps)
  - Self-registers on import (imported by auth/options.ts at server start)
- Built employee.service.ts: CRUD + salary field filtering. listEmployees(canReadSalary) strips baseSalary + nationalId when canReadSalary=false (defense in depth: API is authoritative, UI also checks)
- Built payroll.service.ts: createPayrollRun (gathers ACTIVE employees, calculates via provider, creates PayrollLines) + postPayrollRun (single $transaction: creates ONE balanced JE + updates status to POSTED)
- postPayrollRun JE structure: Debit Salaries Expense = gross+employerIns, Credit Payroll Payable = netPay, Credit Payroll Tax = incomeTax, Credit Social Insurance = empIns+employerIns. Always balanced (debit = gross+employerIns = netPay+incomeTax+empIns+employerIns = credit)
- Added 4 new accounts to seed: account.salaries (EXPENSE), account.payrollPayable (LIABILITY), account.payrollTax (LIABILITY), account.socialInsurance (LIABILITY)
- Added 4 new permissions: hr:read, hr:manage, hr:salary:read, payroll:run
- Added hr_manager role (hr:read + hr:manage + hr:salary:read + payroll:run) + hr@afak.test user
- Added 3 sample employees to tenant-afak (different nationalIds, salaries 8500-15000)
- Built API routes: /api/employees (GET/POST, salary filtering), /api/payroll-runs (GET/POST), /api/payroll-runs/[id] (GET), /api/payroll-runs/[id]/post (POST)
- Built UI: employees-panel (list + create form, salary hidden without permission), payroll-panel (period picker + run + post + per-line breakdown + totals), dashboard nav with 10 sections
- Extended /api/tests with 5 Phase 4 tests (17 total): ALL PASS

Stage Summary:
- All 17 security tests PASS (verified via /api/tests):
  1-12: Phase 0-3 tests all PASS (unchanged)
  13. payroll-post-balanced-je: PASS — 3 employees, JE balanced (39405=39405), amounts correct (gross=35500, tax=1553, empIns=4970, erIns=3905, net=28977)
  14. salary-field-hidden-without-permission: PASS — canReadSalary=false strips baseSalary+nationalId, canReadSalary=true includes them
  15. posted-payroll-immutable: PASS — re-posting a POSTED run rejected (PayrollStateError)
  16. payroll-partial-failure-rollback: PASS — posting non-existent ID rejected, JE count unchanged (108→108)
  17. hr-tenant-isolation: PASS — cross-tenant employee read blocked (null)
- Payroll run 2026-07 created via UI (3 employees), posted → balanced JE in journal (Salaries Expense 5002, Payroll Payable 2003)
- Lint clean, dev server running on port 3000
- NO logic rewritten from existing services — postPayrollRun reuses createJournalEntryOn(tx, ...) from Phase 0

---
Task ID: 65-77
Agent: main-orchestrator
Task: Phase 5 — CRM module (final core module)

Work Log:
- Added Customer, Appointment, AppointmentStatus, Reminder, ActivityLog to Prisma schema
- Added additive `customerId String?` + `customer Customer?` relation on Invoice (no existing fields touched)
- Updated db.ts: added customer, appointment, activityLog to tenant-scoped models
- Built CRM services:
  - activity-log.service.ts: internal logActivity(tx?, customerId, type, refId) — no public endpoint, called only from invoice + appointment services
  - customer.service.ts: listCustomers (with _count stats), getCustomer, createCustomer
  - appointment.service.ts: scheduleAppointment (creates appointment + reminder + activityLog in single $transaction) + getDueReminders (dueAt <= now AND sent=false) + markReminderSent
- Additive edit to createInvoice: added optional `customerId?: string` parameter. When provided, calls logActivity('invoice_created', invoice.id) inside the same tx. When not provided (walk-in sale), no ActivityLog — existing behavior unchanged.
- Fixed security bug in scheduleAppointment: added customer existence check (db.customer.findUnique scoped to current tenant) BEFORE creating the appointment — prevents cross-tenant appointment creation via a stolen customer ID
- Added Zod validations: createCustomerSchema, scheduleAppointmentSchema
- Built API routes: /api/customers (GET/POST), /api/appointments (GET/POST), /api/reminders/due (GET)
- Updated seed: crm:read + crm:manage permissions, added to admin/accountant/cashier/viewer roles, ~90 CRM translations
- Updated middleware to protect /api/customers, /api/appointments, /api/reminders
- Built UI: customers-panel (list + create form with stats), appointments-panel (list + schedule form), reminders-widget (due notifications shown on all dashboard sections), dashboard nav with 12 sections
- Extended /api/tests with 5 Phase 5 tests (22 total): ALL PASS

Stage Summary:
- All 22 security tests PASS (verified via /api/tests):
  1-17: Phase 0-4 tests all PASS (backward compatibility confirmed — no existing test broken)
  18. invoice-customerid-creates-activitylog: PASS — exactly 1 ActivityLog of type 'invoice_created' created automatically
  19. appointment-creates-activitylog-reminder: PASS — 1 ActivityLog 'appointment_scheduled' + 1 Reminder with correct dueAt (scheduledAt - 1h)
  20. reminders-due-filtering: PASS — past appointment reminder found, future appointment reminder excluded
  21. invoice-without-customerid-works: PASS — invoice created successfully, customerId=null, no ActivityLog
  22. crm-tenant-isolation: PASS — cross-tenant customer read blocked (null), cross-tenant appointment blocked (customer not found in current tenant)
- Lint clean, dev server running on port 3000
- CRM panel shows test customers, appointments panel shows scheduled appointments with reminders

---
Task ID: 78-84
Agent: main-orchestrator
Task: Production Hardening — PostgreSQL RLS, atomic sequences, stock locking, payroll tax accuracy

Work Log:
- DOCKER/PostgreSQL NOT available in this sandbox. SQLite remains the active DB. All code is written to be PostgreSQL-compatible; RLS SQL is complete and ready for execution on PostgreSQL.
- Updated prisma/sql/tenant_rls_postgres.sql: now covers ALL 14 tenant-scoped tables (was only 4 in Phase 0). Added ENABLE + FORCE RLS + CREATE POLICY for every table. Added manual verification queries at the end of the file.
- Added SequenceCounter model to schema.prisma: @@id([tenantId, sequenceKey]), lastValue Int @default(0)
- Created src/core/sequence/service.ts: getNextSequenceValue(sequenceKey, tx?) uses Prisma upsert (INSERT ... ON CONFLICT DO UPDATE) — truly atomic on both SQLite and PostgreSQL. No race condition possible.
- Replaced nextInvoiceNumber in invoice.service.ts: now calls getNextSequenceValue('invoice', client) + formatSequenceNumber('INV', value). Old count()+1 pattern removed.
- Replaced nextPurchaseOrderNumber in purchase-order.service.ts: now calls getNextSequenceValue('purchase_order') + formatSequenceNumber('PO', value). Old count()+1 pattern removed.
- Fixed sequence counters to match existing data: ran one-time script to set lastValue = max(existing invoice/PO numbers) per tenant.
- Replaced check-then-write in stock-movement.service.ts recordMovement:
  - Outbound (SALE/TRANSFER_OUT/negative ADJUSTMENT): atomic conditional UPDATE (updateMany WHERE quantity >= absDelta). If 0 rows affected → race condition detected → throw InsufficientStockError. No gap between read and write.
  - Inbound (RECEIPT/TRANSFER_IN/positive ADJUSTMENT): unchanged upsert pattern.
- Rebuilt EgyptPayrollRuleProvider with 7 progressive annual tax brackets per Law 7/2024:
  - 0% up to 40,000 EGP/year
  - 10% on 40,001–55,000
  - 15% on 55,001–70,000
  - 20% on 70,001–200,000
  - 22.5% on 200,001–400,000
  - 25% on 400,001–1,200,000
  - 27.5% above 1,200,000
  - Social insurance: employee 11% / employer 19%, capped at 10,500 EGP/month
  - Tax calculated ANNUALLY then divided by 12 (not monthly brackets)
  - All numbers in named constants with ⚠️ "verify with certified accountant" comment
- Added 4 production hardening tests (26 total): ALL PASS

Stage Summary:
- All 26 tests PASS (22 existing + 4 new):
  23. sequence-concurrency-unique: PASS — 5 concurrent calls → values [1,2,3,4,5], all unique
  24. stock-concurrency-one-succeeds: PASS — 2 concurrent sales × 13 units (stock=13), one fulfilled + one rejected, stock delta=13 (correct)
  25. payroll-tax-7-brackets-accurate: PASS — 15,000 EGP/month: insurance=1155 (11% of capped 10500), tax=1914.83 (annual 22978/12), net=11930.17 — all match manual calculation
  26. rls-sql-complete: PASS — RLS SQL file covers all 14 tenant-scoped tables, has ENABLE+FORCE+POLICY
- Lint clean
- PostgreSQL migration steps documented in prisma/sql/tenant_rls_postgres.sql

---
Task ID: 85
Agent: main-orchestrator
Task: PostgreSQL migration to Supabase + RLS activation + verification

Work Log:
- Changed prisma/schema.prisma: provider = "postgresql", added directUrl = env("DIRECT_URL")
- Configured .env with Supabase connection strings (pooler port 6543 for app, direct port 5432 for migrations)
- Ran `bun run db:push` — all tables created on Supabase PostgreSQL successfully
- Fixed RLS SQL: Prisma creates camelCase columns ("tenantId" not tenant_id) — updated all policies to use quoted camelCase names
- Executed RLS SQL: 42 statements, 0 errors. 14 tables with RLS enabled + forced, 14 policies created
- Ran seed on PostgreSQL: 2 tenants, 7 users, 5 roles, 31 accounts, 24 permissions, 374 translations
- Fixed env loading: bun doesn't auto-load .env for scripts — added manual dotenv loading in seed.ts
- Updated withTenantContext to SET LOCAL app.current_tenant_id for PostgreSQL RLS
- Created hamd_app role (NOSUPERUSER, NOBYPASSRLS) for true RLS testing
- All 26 tests PASS on PostgreSQL (verified via /api/tests)
- RLS verified at database level: hamd_app without context sees 0 rows, with tenant-afak sees 5 users, with tenant-noor sees 2 users, cross-tenant INSERT blocked (error 42501)

Stage Summary:
- PostgreSQL (Supabase) is the active database
- RLS is active and VERIFIED at the database level (not just application middleware)
- All 26 tests PASS on PostgreSQL
- Two layers of defense: (1) Prisma Proxy middleware (application), (2) PostgreSQL RLS (database)
- Even if the application middleware is completely bypassed, the database itself rejects cross-tenant queries

---
Task ID: Phase 7 + Phase 8
Agent: main-orchestrator
Task: Phase 7 (Branding) + Phase 8 (SaaS Billing) — both completed on PostgreSQL/Supabase

Phase 7 Work Log:
- Added BrandSettings model + businessType on Tenant (additive)
- Created getBusinessTypeSeedExtras(businessType) — returns extra accounts per industry (clinic→consultationFees, restaurant→kitchenWaste, retail→salesDiscounts)
- Built branding.service.ts: getBranding (returns defaults if no settings) + updateBranding (upsert)
- Built /api/tenant/branding (GET/PATCH) with tenant:manage permission
- Built branding-panel UI with color pickers, logo URL, invoice footer, live preview
- Tests 27-30: clinic seed extras PASS, branding update+read PASS, backward compat PASS, tenant isolation PASS

Phase 8 Work Log:
- Added Plan, Subscription, SubscriptionStatus, PaymentRecord models to schema
- Created subscription.service.ts with:
  - requireActiveSubscription() — central enforcement (SUSPENDED→GET ok, POST→402; CANCELLED→402)
  - getSubscription() with RLS bypass (SET LOCAL row_security = off)
  - createSubscription() — new tenant gets TRIALING (14 days)
  - recordPayment() — extends currentPeriodEnd, sets ACTIVE
  - checkMaxUsers() / checkMaxInvoices() — usage limit checks
  - listAllTenantsWithSubscriptions() — super-admin only
- Updated withTenantContext to enforce subscription centrally (ONE call, no duplication)
- Added maxInvoicesPerMonth check in createInvoice
- Added SubscriptionSuspendedError + UsageLimitExceededError to lib/api.ts with 402 status mapping
- Built /api/admin/tenants (GET) + /api/admin/payments (POST) — platform:admin only, uses dbRaw
- Added platform:admin permission + super_admin role + superadmin@hamd.test user in seed
- Created starter Plan + ACTIVE subscriptions for existing demo tenants
- Tests 31-35: trialing auto PASS, payment extends PASS, suspended 402 PASS, maxUsers PASS, admin isolation PASS

Stage Summary:
- All 35 tests PASS on PostgreSQL (Supabase):
  1-26: Phase 0-5 + Production Hardening all PASS
  27-30: Phase 7 (Branding) all PASS
  31-35: Phase 8 (SaaS Billing) all PASS
- Subscription enforcement is CENTRALIZED in withTenantContext — no duplication
- platform:admin is completely separate from tenant RBAC — regular admin CANNOT access /api/admin/*
- SUSPENDED tenants can read but not write (402) — data hostage prevention
- Lint clean
