/**
 * GET /api/purchase-orders/:id  — get a single PO (with lines)
 *
 * runtime = 'nodejs' (Prisma). Auth + permission. Service-only Prisma.
 */
import { withTenantContext } from '@/core/auth/session'
import { getPurchaseOrder } from '@/modules/inventory/purchase-order.service'
import { ok, mapError, notFound } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const result = await withTenantContext(async () => getPurchaseOrder(id))
    if (result.status === 401) return ok({ authenticated: false }, 401)
    if (!result) return notFound('en', 'purchaseOrder.notFound')
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}
