/**
 * POST /api/invoices/:id/void
 *
 * Voids a POSTED invoice by creating a reversing JournalEntry (debit↔credit
 * swapped) and setting status to VOID. The original JE is NOT deleted —
 * it stays for audit. No deletion of financial records.
 *
 * runtime = 'nodejs' (Prisma). Auth + permission (invoice:void). Service-only.
 */
import { withTenantContext } from '@/core/auth/session'
import { voidInvoice } from '@/modules/accounting/invoice.service'
import { ok, mapError } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const result = await withTenantContext(async () => {
      return voidInvoice(id)
    }, 'POST')
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}
