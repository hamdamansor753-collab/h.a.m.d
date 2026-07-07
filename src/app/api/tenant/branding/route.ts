/**
 * GET  /api/tenant/branding   — return the current tenant's BrandSettings
 *                              (or { branding: null } when none exists; the
 *                              UI falls back to H.A.M.D defaults).
 * PATCH /api/tenant/branding  — update BrandSettings (requires tenant:manage).
 *
 * runtime = 'nodejs' (Prisma). All input via Zod. No direct Prisma calls —
 * everything goes through branding.service.ts.
 *
 * Per /upload/product-customization.md:
 *  - GET is open to any authenticated user in the tenant (branding must
 *    render for cashiers at the POS, etc.).
 *  - PATCH requires `tenant:manage` (admin only) — enforced in the service
 *    layer (`requirePermission('tenant:manage')`) AND surfaced as 403 to
 *    the client via `mapError` when the RBAC check throws RbacError.
 *
 * Tenant isolation:
 *  - The service reads `tenantId` from the active tenant context (set by
 *    `withTenantContext`), so a PATCH from tenant A can NEVER reach
 *    tenant B's BrandSettings — there is no `tenantId` in the request body
 *    to spoof.
 */
import { withTenantContext } from '@/core/auth/session'
import { dbRaw } from '@/lib/db'
import { getBranding, updateBranding } from '@/modules/branding/branding.service'
import { updateBrandingSchema } from '@/lib/validations'
import { ok, mapError, badRequest } from '@/lib/api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await withTenantContext(async (ctx) => {
      // Read BrandSettings + the tenant's businessType in parallel. We use
      // dbRaw.tenant here because `tenant` is intentionally NOT in the
      // scoped-delegate set (a tenant shouldn't be able to enumerate OTHER
      // tenants). This is a self-lookup by the active tenant's own id.
      const [branding, tenant] = await Promise.all([
        getBranding(ctx.tenantId),
        dbRaw.tenant.findUnique({
          where: { id: ctx.tenantId },
          select: { businessType: true },
        }),
      ])
      return {
        branding,
        businessType: tenant?.businessType ?? 'general',
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
    const parsed = updateBrandingSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }

    const result = await withTenantContext(async (ctx) => {
      return updateBranding(ctx.tenantId, {
        logoUrl: parsed.data.logoUrl ?? undefined,
        primaryColor: parsed.data.primaryColor,
        accentColor: parsed.data.accentColor,
        invoiceFooterText: parsed.data.invoiceFooterText ?? undefined,
      })
    }, 'PATCH')
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok({ branding: result })
  } catch (err) {
    return mapError(err, 'en')
  }
}
