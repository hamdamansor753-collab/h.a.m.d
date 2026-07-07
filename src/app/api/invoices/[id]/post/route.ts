/**
 * POST /api/invoices/:id/post
 *
 * Posts a DRAFT invoice to the ledger:
 *  1. Calculates tax via the tenant's TaxProvider (EG = 14% VAT)
 *  2. Creates a balanced JournalEntry (reuses Phase 0's prepareJournalEntry)
 *  3. Updates invoice status to POSTED + links journalEntryId
 *  All atomic in a single db.$transaction.
 *
 * runtime = 'nodejs' (Prisma). Auth + permission (invoice:post). Service-only.
 */
import { withTenantContext } from '@/core/auth/session'
import { postInvoice } from '@/modules/accounting/invoice.service'
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
      return postInvoice(id)
    }, 'POST')
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}
