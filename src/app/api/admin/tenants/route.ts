/**
 * GET /api/admin/tenants
 *
 * Super-admin only — lists every tenant on the platform with their
 * subscription + plan info. Used by the billing panel to show the
 * platform owner who's paying, who's trialing, who's suspended.
 *
 * Authorization: `platform:admin` — a separate grant from normal RBAC,
 * checked via the `PLATFORM_ADMINS` env var (comma-separated emails).
 * Per /upload/saas-billing.md §"الصلاحيات الجديدة": this is NOT a
 * per-tenant permission; it's an out-of-band grant for the platform owner.
 *
 * This route does NOT use `withTenantContext` — it's a cross-tenant read
 * that must bypass the normal tenant scoping. The billing service uses
 * `dbRaw` directly (auditable, documented).
 */
import { getSession } from '@/core/auth/session'
import { isPlatformAdmin } from '@/core/auth/platform-admin'
import { listAllTenantsWithSubscriptions } from '@/modules/billing/subscription.service'
import { ok, unauthorized, platformAdminRequired } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session?.user) {
    return unauthorized('en')
  }
  if (!isPlatformAdmin(session.user.email)) {
    return platformAdminRequired(session.user.locale || 'en')
  }
  const tenants = await listAllTenantsWithSubscriptions()
  return ok({ tenants })
}
