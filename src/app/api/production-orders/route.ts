import { withTenantContext } from '@/core/auth/session'
import { listProductionOrders, createProductionOrder } from '@/modules/manufacturing/production.service'
import { ok, mapError, badRequest } from '@/lib/api'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await withTenantContext(async () => listProductionOrders())
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) { return mapError(err, 'en') }
}

const createPOSchema = z.object({ finishedProductId: z.string().min(1), quantity: z.coerce.number().min(0.01), warehouseId: z.string().min(1) })

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = createPOSchema.safeParse(body)
    if (!parsed.success) return badRequest('en', 'common.error', parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })))
    const result = await withTenantContext(async () => createProductionOrder({ finishedProductId: parsed.data.finishedProductId, quantity: parsed.data.quantity, warehouseId: parsed.data.warehouseId }), 'POST')
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result, 201)
  } catch (err) { return mapError(err, 'en') }
}
