/**
 * GET  /api/tenant/branding  — get brand settings for current tenant
 * PATCH /api/tenant/branding  — update brand settings
 *
 * runtime = 'nodejs' (Prisma). Zod-validated. Service-only Prisma.
 * Permission: tenant:manage (admin only).
 */
import { withTenantContext } from '@/core/auth/session'
import { getBranding, updateBranding } from '@/modules/branding/branding.service'
import { ok, mapError, badRequest } from '@/lib/api'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const brandingUpdateSchema = z.object({
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like #0f172a').optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a hex color like #06b6d4').optional(),
  invoiceFooterText: z.string().max(500).nullable().optional(),
})

export async function GET() {
  try {
    const result = await withTenantContext(async () => getBranding())
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const parsed = brandingUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest('en', 'common.error', parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })))
    }
    const result = await withTenantContext(async () =>
      updateBranding({
        logoUrl: parsed.data.logoUrl,
        primaryColor: parsed.data.primaryColor,
        accentColor: parsed.data.accentColor,
        invoiceFooterText: parsed.data.invoiceFooterText,
      })
    )
    if (result.status === 401) return ok({ authenticated: false }, 401)
    return ok(result)
  } catch (err) {
    return mapError(err, 'en')
  }
}
