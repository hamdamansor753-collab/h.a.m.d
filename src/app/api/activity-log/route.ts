/**
 * GET /api/activity-log  — list activity log entries for the current tenant.
 *
 * Query params:
 *   ?customerId=<uuid>  (optional) — filter to a specific customer
 *
 * runtime = 'nodejs' (Prisma). Auth + permission. Service-only Prisma.
 */
import { withTenantContext } from '@/core/auth/session'
import { listActivityLog } from '@/modules/crm/crm.service'
import { ok, mapError, badRequest } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const customerId = url.searchParams.get('customerId') ?? undefined

    // Cheap sanity check: if customerId is provided, it must be a non-empty
    // string. The service will resolve it against the tenant; an unknown id
    // simply yields an empty list (no 404).
    if (customerId !== undefined && customerId.trim() === '') {
      return badRequest('en', 'common.error')
    }

    const result = await withTenantContext(async () =>
      listActivityLog(customerId)
    )
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}
