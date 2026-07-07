import { withTenantContext } from '@/core/auth/session'
import { completeProductionOrder } from '@/modules/manufacturing/production.service'
import { ok, mapError } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const result = await withTenantContext(async () => completeProductionOrder(id), 'POST')
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) { return mapError(err, 'en') }
}
