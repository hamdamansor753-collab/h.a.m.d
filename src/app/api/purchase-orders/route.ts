/**
 * GET  /api/purchase-orders       — list POs for current tenant
 * POST /api/purchase-orders       — create a new DRAFT PO
 *
 * runtime = 'nodejs' (Prisma). Zod-validated. Service-only Prisma.
 */
import { withTenantContext } from '@/core/auth/session'
import { listPurchaseOrders, createPurchaseOrder } from '@/modules/inventory/purchase-order.service'
import { createPurchaseOrderSchema } from '@/lib/validations'
import { ok, mapError, badRequest } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await withTenantContext(async () => listPurchaseOrders())
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = createPurchaseOrderSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }
    const result = await withTenantContext(async () =>
      createPurchaseOrder({
        supplierName: parsed.data.supplierName,
        date: new Date(parsed.data.date),
        lines: parsed.data.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          warehouseId: l.warehouseId,
        })),
      })
    , 'POST')
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result, 201)
  } catch (err) {
    return mapError(err, 'en')
  }
}
