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
