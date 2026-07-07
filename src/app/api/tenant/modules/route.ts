/**
 * GET  /api/tenant/modules  — return the current tenant's industry profile:
 *                              { businessType, defaultModules, activeModules,
 *                                overrides }
 *                              Open to any authenticated user in the tenant
 *                              (the dashboard needs it to filter the nav).
 *
 * PATCH /api/tenant/modules  — set a single module override
 *                              Body: { moduleKey, enabled }
 *                              Requires `tenant:manage` (admin only) —
 *                              enforced in the service layer.
 *
 * runtime = 'nodejs' (Prisma). All input via Zod. Tenant isolation: the
 * `tenantId` is derived from the JWT context inside `withTenantContext`,
 * NEVER from the request body — a tenant cannot read or write another
 * tenant's overrides.
 *
 * Per /upload/industry-activation.md:
 *  - GET is open to any authenticated user in the tenant (the dashboard
 *    needs to know which nav items to render).
 *  - PATCH requires `tenant:manage` (admin only) — enforced in
 *    `setModuleOverride` via `requirePermission('tenant:manage')`, and
 *    surfaced as 403 to the client via `mapError` when the RBAC check
 *    throws RbacError.
 *  - All API routes remain functional regardless of these settings —
 *    this endpoint controls NAV VISIBILITY only (visual filter), never
 *    backend access.
 */
import { withTenantContext } from '@/core/auth/session'
import {
  getBusinessType,
  getModuleOverrides,
  setModuleOverride,
} from '@/modules/branding/branding.service'
import {
  getDefaultModules,
  getEffectiveModules,
} from '@/modules/branding/industry-modules'
import { setModuleOverrideSchema } from '@/lib/validations'
import { ok, mapError, badRequest } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await withTenantContext(async (ctx) => {
      const [businessType, overrides] = await Promise.all([
        getBusinessType(ctx.tenantId),
        getModuleOverrides(ctx.tenantId),
      ])
      const defaultModules = getDefaultModules(businessType)
      const activeModules = await getEffectiveModules(ctx.tenantId, businessType)
      return {
        businessType,
        defaultModules,
        activeModules,
        overrides: overrides.map((o) => ({
          moduleKey: o.moduleKey,
          enabled: o.enabled,
        })),
      }
    })
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const parsed = setModuleOverrideSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }

    const result = await withTenantContext(async (ctx) => {
      return setModuleOverride(
        ctx.tenantId,
        parsed.data.moduleKey,
        parsed.data.enabled
      )
    }, 'PATCH')
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok({
      moduleKey: parsed.data.moduleKey,
      enabled: parsed.data.enabled,
    })
  } catch (err) {
    return mapError(err, 'en')
  }
}
