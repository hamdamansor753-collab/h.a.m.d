/**
 * POST /api/payroll-runs/:id/post
 *
 * Posts a DRAFT payroll run:
 *  1. Resolve 5 ledger accounts (SalariesExpense, PayrollPayable,
 *     EmployeeInsurance, EmployerInsurance, IncomeTaxPayable).
 *  2. Compute totals from lines.
 *  3. ONE balanced JournalEntry (Debit SalariesExpense, Credit ×4 liability accounts).
 *  4. PayrollRun status → POSTED, link journalEntryId.
 *  All atomic in a single db.$transaction.
 *
 * runtime = 'nodejs' (Prisma). Auth + permission (hr:run). Service-only.
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
    const result = await withTenantContext(async () => postPayrollRun(id), 'POST')
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}
