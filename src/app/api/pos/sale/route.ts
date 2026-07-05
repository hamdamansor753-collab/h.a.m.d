/**
 * POST /api/pos/sale
 *
 * Execute a POS sale: creates + posts an invoice (channel=POS, debits Cash),
 * records stock movements + COGS journal entries for each line. All stock
 * is pre-checked BEFORE any write — if any line has insufficient stock,
 * the entire sale is rejected with zero side effects.
 *
 * runtime = 'nodejs' (Prisma). Auth + permission (pos:sell). Zod-validated.
 * Service-only — delegates entirely to posSale() in pos-sale.service.ts.
 */
import { withTenantContext } from '@/core/auth/session'
import { posSale } from '@/modules/pos/pos-sale.service'
import { posSaleSchema } from '@/lib/validations'
import { ok, mapError, badRequest } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = posSaleSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }
    const result = await withTenantContext(async () => {
      return posSale({
        warehouseId: parsed.data.warehouseId,
        customerName: parsed.data.customerName,
        lines: parsed.data.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      })
    })
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result, 201)
  } catch (err) {
    return mapError(err, 'en')
  }
}
