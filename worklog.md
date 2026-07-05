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
