/**
 * POST /api/tests
 *
 * Runs the two mandatory Phase 0 security tests and returns structured
 * pass/fail results. Per /upload/05-security-baseline.md section 5:
 * tenant-isolation tests must verify ACTUAL cross-tenant rejection, not
 * a theoretical assumption. Per /upload/04-data-model.md note 3: an
 * unbalanced JournalEntry must be rejected.
 *
 * Test 1 — Tenant isolation:
 *   1. Identify the OTHER tenant (the one the current user does NOT belong to).
 *   2. Using `dbRaw` (the raw Prisma client without tenant middleware —
 *      the auditable cross-tenant escape hatch), read one of the OTHER
 *      tenant's account IDs. (This simulates an attacker
 *      who somehow learned another tenant's account ID.)
 *   3. Try to read that account through the SERVICE LAYER (which is scoped
 *      to the current user's tenant by the Prisma middleware). The service
 *      MUST return null — the middleware silently filters it out.
 *   4. Try to UPDATE that account through the service layer (raw db call
 *      inside the current tenant context). The update MUST affect 0 rows.
 *
 *   The test PASSES if both the read returns null AND the update affects
 *   0 rows. Any other outcome is a critical security failure.
 *
 * Test 2 — Journal balance:
 *   1. Attempt to create a JournalEntry where debit=100, credit=50
 *      (unbalanced). The service MUST throw JournalBalanceError.
 *   2. Attempt to create a balanced entry (debit=100, credit=100). The
 *      service MUST succeed.
 *   3. Clean up the balanced entry.
 *
 *   The test PASSES if the unbalanced attempt throws AND the balanced
 *   attempt succeeds.
 *
 * runtime = 'nodejs' (Prisma). Auth-required.
 */
import { withTenantContext } from '@/core/auth/session'
import { getAccount } from '@/core/ledger/account.service'
import { createJournalEntry } from '@/core/ledger/journal-entry.service'
import { JournalBalanceError } from '@/lib/api'
import { db, dbRaw } from '@/lib/db'
import { ok, mapError, unauthorized } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TestResult {
  name: string
  passed: boolean
  details: Record<string, unknown>
}

export async function POST() {
  try {
    const results = await withTenantContext(async (ctx) => {
      const results: TestResult[] = []

      // ---------------- Test 1: Tenant isolation ----------------
      // Find the OTHER tenant's account. We use `dbRaw` (the raw client
      // without tenant middleware) here because this lookup is INTENTIONALLY
      // cross-tenant — it simulates an attacker who somehow learned another
      // tenant's account ID. This is one of the three auditable dbRaw uses.
      const otherTenantAccount = await dbRaw.account.findFirst({
        where: { tenantId: { not: ctx.tenantId } },
        select: { id: true, code: true, tenantId: true },
      })

      if (!otherTenantAccount) {
        results.push({
          name: 'tenant-isolation',
          passed: false,
          details: { reason: 'No other-tenant account found to test against (seed missing?)' },
        })
      } else {
        // (a) Attempt to READ the other tenant's account via the service
        //     layer. The middleware should filter it out → null.
        const leakedRead = await getAccount(otherTenantAccount.id)

        // (b) Attempt to UPDATE the other tenant's account via a direct
        //     Prisma call inside the current tenant context. The middleware
        //     will inject `tenantId = ctx.tenantId` into the where clause,
        //     so the update will affect 0 rows (no matching row in our
        //     tenant with that ID).
        let updateAffected = -1
        try {
          const upd = await db.account.updateMany({
            where: { id: otherTenantAccount.id },
            data: { nameKey: 'account.tampered' },
          })
          updateAffected = upd.count
        } catch {
          updateAffected = -1
        }

        // (c) Attempt to CREATE a JournalEntry referencing the other
        //     tenant's account ID. The journal service verifies every
        //     line's accountId belongs to the current tenant; the other
        //     tenant's account ID will not be found in the scoped
        //     findMany → the service rejects the create.
        let crossTenantCreateBlocked = false
        let crossTenantCreateError: string | null = null
        try {
          await createJournalEntry({
            date: new Date(),
            description: 'cross-tenant attempt',
            sourceModule: 'accounting',
            sourceRefId: 'test-cross-tenant',
            lines: [
              { accountId: otherTenantAccount.id, debit: 10, credit: 0 },
              { accountId: otherTenantAccount.id, debit: 0, credit: 10 },
            ],
          })
          // If we get here, the cross-tenant create was NOT blocked — FAIL.
          crossTenantCreateBlocked = false
        } catch (e) {
          crossTenantCreateBlocked = true
          crossTenantCreateError = e instanceof Error ? e.name : 'unknown'
        }

        const passed =
          leakedRead === null &&
          updateAffected === 0 &&
          crossTenantCreateBlocked === true

        results.push({
          name: 'tenant-isolation',
          passed,
          details: {
            currentTenantId: ctx.tenantId,
            otherTenantId: otherTenantAccount.tenantId,
            otherTenantAccountCode: otherTenantAccount.code,
            crossTenantReadResult: leakedRead === null ? 'null (blocked)' : 'LEAKED',
            crossTenantUpdateAffected: updateAffected,
            crossTenantJournalCreateBlocked: crossTenantCreateBlocked,
            crossTenantJournalCreateError: crossTenantCreateError,
          },
        })
      }

      // ---------------- Test 2: Journal balance ----------------
      // Find two accounts in the current tenant to use for the test.
      const myAccounts = await db.account.findMany({ take: 2, select: { id: true, code: true } })
      if (myAccounts.length < 2) {
        results.push({
          name: 'journal-balance',
          passed: false,
          details: { reason: 'Need at least 2 accounts in current tenant' },
        })
      } else {
        const [a, b] = myAccounts

        // (a) Unbalanced: debit 100, credit 50 → MUST throw.
        let unbalancedRejected = false
        let unbalancedError: string | null = null
        try {
          await createJournalEntry({
            date: new Date(),
            description: 'unbalanced test',
            sourceModule: 'accounting',
            sourceRefId: 'test-unbalanced',
            lines: [
              { accountId: a.id, debit: 100, credit: 0 },
              { accountId: b.id, debit: 0, credit: 50 },
            ],
          })
          unbalancedRejected = false
        } catch (e) {
          unbalancedRejected = e instanceof JournalBalanceError
          unbalancedError = e instanceof Error ? e.name : 'unknown'
        }

        // (b) Balanced: debit 100, credit 100 → MUST succeed.
        let balancedCreated = false
        let balancedId: string | null = null
        try {
          const entry = await createJournalEntry({
            date: new Date(),
            description: 'balanced test',
            sourceModule: 'accounting',
            sourceRefId: 'test-balanced',
            lines: [
              { accountId: a.id, debit: 100, credit: 0 },
              { accountId: b.id, debit: 0, credit: 100 },
            ],
          })
          balancedCreated = true
          balancedId = entry.id
          // Cleanup — delete within the same tenant context (middleware
          // scopes the delete to the current tenant; the row belongs to
          // us so it succeeds).
          await db.journalEntry.delete({ where: { id: entry.id } })
        } catch (e) {
          balancedCreated = false
          balancedId = null
        }

        const passed = unbalancedRejected && balancedCreated
        results.push({
          name: 'journal-balance',
          passed,
          details: {
            unbalancedRejected,
            unbalancedError,
            balancedCreated,
            balancedId,
            cleanedUp: balancedCreated,
          },
        })
      }

      return results
    })

    if ('status' in results) return unauthorized('en')
    return ok({ results, allPassed: results.every((r) => r.passed) })
  } catch (err) {
    return mapError(err, 'en')
  }
}
