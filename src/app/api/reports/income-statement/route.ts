/**
 * GET /api/reports/income-statement
 *
 * Simplified income statement computed directly from JournalLine (joined
 * to Account by type). Revenue = credit - debit; Expense = debit - credit;
 * Net income = total revenue - total expenses.
 *
 * No separate "report" table — the ledger IS the source of truth.
 *
 * runtime = 'nodejs' (Prisma). Auth + permission (journal:read). Service-only.
 */
import { withTenantContext } from '@/core/auth/session'
import { getIncomeStatement } from '@/modules/accounting/income-statement.service'
import { ok, mapError } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await withTenantContext(async () => {
      return getIncomeStatement()
    })
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}
