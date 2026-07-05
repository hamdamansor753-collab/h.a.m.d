/**
 * POST /api/purchase-orders/:id/receive
 *
 * Receives a DRAFT purchase order:
 *  1. For each line: StockMovement(RECEIPT) + StockLevel update + costPrice update
 *  2. ONE balanced JournalEntry (Debit Inventory, Credit AP)
 *  3. PO status → RECEIVED
 *  All atomic in a single db.$transaction.
 *
 * runtime = 'nodejs' (Prisma). Auth + permission (purchase:receive). Service-only.
 */
import { withTenantContext } from '@/core/auth/session'
import { receivePurchaseOrder } from '@/modules/inventory/purchase-order.service'
import { ok, mapError } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const result = await withTenantContext(async () => receivePurchaseOrder(id))
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}
