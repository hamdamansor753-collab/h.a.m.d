/**
 * POST /api/payroll-runs/:id/post
 *
 * Posts a DRAFT payroll run to the ledger:
 *  1. Creates ONE balanced JournalEntry (aggregated for all employees)
 *  2. Updates payroll run status to POSTED + links journalEntryId
 *  All atomic in a single db.$transaction.
 *
 * runtime = 'nodejs' (Prisma). Auth + permission (payroll:run). Service-only.
 */
import { withTenantContext } from '@/core/auth/session'
import { postPayrollRun } from '@/modules/hr/payroll.service'
import { ok, mapError } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const result = await withTenantContext(async () => postPayrollRun(id))
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}
